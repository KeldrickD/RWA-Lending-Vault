// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./AggregatorV3Interface.sol";

/**
 * RWA Lending Vault V4 - Oracle-ready with freshness checks
 * Extends V3 with:
 * - Stale price detection (fallback to 1:1 if updatedAt > 1 hour old)
 * - setPriceFeed() for owner to update oracles post-deploy
 * - getTokenPriceUSD() public view for frontend
 * - Oracle-aware for mainnet migration (Chainlink feeds)
 */
contract RWALendingVaultV4 is Ownable, ReentrancyGuard {
    struct Loan {
        uint256 amount;
        uint256 lastAccrueTime;
        bool isActive;
    }

    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 public constant RATE_PRECISION = 10000;
    uint256 public constant STALE_PRICE_THRESHOLD = 1 hours;

    uint256 public collateralFactor = 50;
    uint256 public liquidationThreshold = 125;
    uint256 public liquidationBonus = 5;

    uint256 public utilizationBaseRate = 200;
    uint256 public slope1 = 800;
    uint256 public slope2 = 4000;
    uint256 public optimalUtilization = 8000;

    uint256 public totalSuppliedETH;
    uint256 public totalBorrowedETH;

    address[] public collateralTokenList;
    mapping(address => bool) public supportedCollaterals;
    mapping(address => AggregatorV3Interface) public priceFeeds;
    mapping(address => mapping(address => uint256)) public collateralBalances;
    mapping(address => Loan) public loans;

    uint256 private constant PRICE_FEED_DECIMALS = 8;
    uint256 private constant COLLATERAL_DECIMALS = 18;

    event CollateralDeposited(address indexed user, address indexed token, uint256 amount);
    event CollateralWithdrawn(address indexed user, address indexed token, uint256 amount);
    event LoanTaken(address indexed user, uint256 amount);
    event LoanRepaid(address indexed user, uint256 amount, uint256 interestPaid);
    event Liquidated(address indexed user, address indexed liquidator, uint256 debtRepaid);
    event LendingPoolDeposited(address indexed by, uint256 amount);
    event ExcessWithdrawn(address indexed by, uint256 amount);
    event CollateralTokenAdded(address indexed token, address indexed priceFeed);
    event PriceFeedUpdated(address indexed token, address indexed priceFeed);
    event RateParamsUpdated(uint256 baseRate, uint256 slope1, uint256 slope2, uint256 optimal);

    modifier accrueInterest(address _user) {
        _accrueInterest(_user);
        _;
    }

    constructor(
        address[] memory _tokens,
        address[] memory _priceFeeds,
        uint256 _collateralFactor,
        uint256 _liquidationThreshold,
        uint256 _liquidationBonus
    ) Ownable(msg.sender) {
        require(_collateralFactor <= 100, "Collateral factor must be <= 100");
        require(_liquidationThreshold >= 100 && _liquidationThreshold <= 200, "Liquidation threshold 100-200");
        require(_liquidationBonus <= 50, "Liquidation bonus <= 50");
        require(_tokens.length == _priceFeeds.length, "Token/feed length mismatch");

        collateralFactor = _collateralFactor;
        liquidationThreshold = _liquidationThreshold;
        liquidationBonus = _liquidationBonus;

        for (uint256 i = 0; i < _tokens.length; i++) {
            require(_tokens[i] != address(0), "Invalid token");
            supportedCollaterals[_tokens[i]] = true;
            collateralTokenList.push(_tokens[i]);
            priceFeeds[_tokens[i]] = AggregatorV3Interface(_priceFeeds[i]);
        }
    }

    function addCollateralToken(address _token, address _priceFeed) external onlyOwner {
        require(_token != address(0), "Invalid token");
        require(!supportedCollaterals[_token], "Already supported");
        supportedCollaterals[_token] = true;
        collateralTokenList.push(_token);
        priceFeeds[_token] = AggregatorV3Interface(_priceFeed);
        emit CollateralTokenAdded(_token, _priceFeed);
    }

    function setPriceFeed(address _token, address _priceFeed) external onlyOwner {
        require(supportedCollaterals[_token], "Token not supported");
        priceFeeds[_token] = AggregatorV3Interface(_priceFeed);
        emit PriceFeedUpdated(_token, _priceFeed);
    }

    function setRateParams(
        uint256 _baseRate,
        uint256 _slope1,
        uint256 _slope2,
        uint256 _optimalUtilization
    ) external onlyOwner {
        require(_optimalUtilization <= RATE_PRECISION, "Optimal must be <= 10000");
        utilizationBaseRate = _baseRate;
        slope1 = _slope1;
        slope2 = _slope2;
        optimalUtilization = _optimalUtilization;
        emit RateParamsUpdated(_baseRate, _slope1, _slope2, _optimalUtilization);
    }

    function depositLendingPool() external payable onlyOwner {
        require(msg.value > 0, "Amount must be > 0");
        totalSuppliedETH += msg.value;
        emit LendingPoolDeposited(msg.sender, msg.value);
    }

    function withdrawExcessETH(uint256 _amount) external onlyOwner nonReentrant {
        require(_amount > 0, "Amount must be > 0");
        uint256 freeLiquidity = totalSuppliedETH > totalBorrowedETH ? totalSuppliedETH - totalBorrowedETH : 0;
        require(address(this).balance >= _amount, "Insufficient balance");
        require(_amount <= freeLiquidity, "Cannot withdraw borrowed funds");
        totalSuppliedETH -= _amount;
        (bool ok,) = payable(owner()).call{value: _amount}("");
        require(ok, "Transfer failed");
        emit ExcessWithdrawn(msg.sender, _amount);
    }

    function setCollateralFactor(uint256 _newFactor) external onlyOwner {
        require(_newFactor <= 100, "Collateral factor must be <= 100");
        collateralFactor = _newFactor;
    }

    function setLiquidationParams(uint256 _threshold, uint256 _bonus) external onlyOwner {
        require(_threshold >= 100 && _threshold <= 200, "Invalid threshold");
        require(_bonus <= 50, "Bonus <= 50");
        liquidationThreshold = _threshold;
        liquidationBonus = _bonus;
    }

    function _getTokenPriceUSD(address _token) internal view returns (uint256) {
        AggregatorV3Interface feed = priceFeeds[_token];
        if (address(feed) == address(0)) return 1e18;
        try feed.latestRoundData() returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80) {
            require(answer > 0, "Invalid price");
            if (block.timestamp > updatedAt && (block.timestamp - updatedAt) > STALE_PRICE_THRESHOLD) {
                return 1e18;
            }
            return uint256(uint256(answer) * 1e18 / (10 ** PRICE_FEED_DECIMALS));
        } catch {
            return 1e18;
        }
    }

    function getTokenPriceUSD(address _token) external view returns (uint256) {
        return _getTokenPriceUSD(_token);
    }

    function _getCollateralValueUSD(address _user) internal view returns (uint256) {
        uint256 total;
        for (uint256 i = 0; i < collateralTokenList.length; i++) {
            address t = collateralTokenList[i];
            uint256 bal = collateralBalances[_user][t];
            if (bal == 0) continue;
            uint256 price = _getTokenPriceUSD(t);
            total += (bal * price) / (10 ** COLLATERAL_DECIMALS);
        }
        return total;
    }

    function _getRequiredCollateralValueUSD(uint256 _debtETH) internal view returns (uint256) {
        return (_debtETH * 100) / collateralFactor;
    }

    function getCurrentBorrowRate() public view returns (uint256) {
        if (totalSuppliedETH == 0) return utilizationBaseRate;
        uint256 util = (totalBorrowedETH * RATE_PRECISION) / totalSuppliedETH;
        if (util <= optimalUtilization) {
            return utilizationBaseRate + (slope1 * util) / optimalUtilization;
        } else {
            return utilizationBaseRate + slope1
                + (slope2 * (util - optimalUtilization)) / (RATE_PRECISION - optimalUtilization);
        }
    }

    function _accrueInterest(address _user) internal {
        Loan storage loan = loans[_user];
        if (!loan.isActive || loan.amount == 0) return;

        uint256 elapsed = block.timestamp - loan.lastAccrueTime;
        if (elapsed == 0) return;

        uint256 rate = getCurrentBorrowRate();
        uint256 interest = (loan.amount * rate * elapsed) / (RATE_PRECISION * SECONDS_PER_YEAR);
        if (interest > 0) {
            loan.amount += interest;
            totalBorrowedETH += interest;
        }
        loan.lastAccrueTime = block.timestamp;
    }

    function _getHealthFactor(address _user) internal view returns (uint256) {
        Loan memory userLoan = loans[_user];
        if (!userLoan.isActive || userLoan.amount == 0) return type(uint256).max;
        uint256 collValue = _getCollateralValueUSD(_user);
        uint256 debtValue = userLoan.amount;
        if (debtValue == 0) return type(uint256).max;
        return (collValue * 100) / (debtValue * liquidationThreshold / 100);
    }

    function depositCollateral(address _token, uint256 _amount) external nonReentrant {
        require(supportedCollaterals[_token], "Token not supported");
        require(_amount > 0, "Amount must be > 0");
        collateralBalances[msg.sender][_token] += _amount;
        IERC20(_token).transferFrom(msg.sender, address(this), _amount);
        emit CollateralDeposited(msg.sender, _token, _amount);
    }

    function withdrawCollateral(address _token, uint256 _amount) external nonReentrant accrueInterest(msg.sender) {
        require(supportedCollaterals[_token], "Token not supported");
        require(_amount > 0, "Amount must be > 0");
        require(collateralBalances[msg.sender][_token] >= _amount, "Insufficient collateral");

        Loan memory userLoan = loans[msg.sender];
        if (userLoan.isActive) {
            uint256 collValue = _getCollateralValueUSD(msg.sender);
            uint256 price = _getTokenPriceUSD(_token);
            uint256 withdrawValue = (_amount * price) / (10 ** COLLATERAL_DECIMALS);
            uint256 newValue = collValue > withdrawValue ? collValue - withdrawValue : 0;
            uint256 required = _getRequiredCollateralValueUSD(userLoan.amount);
            require(newValue >= required, "Would exceed LTV");
        }

        collateralBalances[msg.sender][_token] -= _amount;
        IERC20(_token).transfer(msg.sender, _amount);
        emit CollateralWithdrawn(msg.sender, _token, _amount);
    }

    function takeLoan(uint256 _amount) external nonReentrant accrueInterest(msg.sender) {
        require(_amount > 0, "Amount must be > 0");
        require(!loans[msg.sender].isActive, "Existing loan must be repaid first");
        uint256 maxLoan = _getMaxBorrow(msg.sender);
        require(_amount <= maxLoan, "Loan exceeds collateral limit");
        require(address(this).balance >= _amount, "Insufficient lending pool balance");

        loans[msg.sender] = Loan({
            amount: _amount,
            lastAccrueTime: block.timestamp,
            isActive: true
        });
        totalBorrowedETH += _amount;

        (bool ok,) = payable(msg.sender).call{value: _amount}("");
        require(ok, "Transfer failed");
        emit LoanTaken(msg.sender, _amount);
    }

    function repayLoan() external payable nonReentrant accrueInterest(msg.sender) {
        uint256 _amount = msg.value;
        require(_amount > 0, "Amount must be > 0");
        Loan storage userLoan = loans[msg.sender];
        require(userLoan.isActive, "No active loan");
        require(_amount <= userLoan.amount, "Repay amount exceeds debt");

        userLoan.amount -= _amount;
        totalBorrowedETH -= _amount;
        if (userLoan.amount == 0) userLoan.isActive = false;

        emit LoanRepaid(msg.sender, _amount, 0);

        if (msg.value > _amount) {
            (bool refund,) = payable(msg.sender).call{value: msg.value - _amount}("");
            require(refund, "Refund failed");
        }
    }

    function liquidate(address _user) external payable nonReentrant accrueInterest(_user) {
        Loan storage userLoan = loans[_user];
        require(userLoan.isActive, "No active loan");
        uint256 hf = _getHealthFactor(_user);
        require(hf < 100, "Position not liquidatable");

        uint256 debtToRepay = userLoan.amount < msg.value ? userLoan.amount : msg.value;
        require(debtToRepay > 0, "Must send ETH to repay debt");

        uint256 totalCollValue = _getCollateralValueUSD(_user);
        require(totalCollValue > 0, "No collateral");

        uint256 valueToSeize = (debtToRepay * (100 + liquidationBonus)) / 100;
        if (valueToSeize > totalCollValue) valueToSeize = totalCollValue;

        userLoan.amount -= debtToRepay;
        totalBorrowedETH -= debtToRepay;
        if (userLoan.amount == 0) userLoan.isActive = false;

        for (uint256 i = 0; i < collateralTokenList.length; i++) {
            address t = collateralTokenList[i];
            uint256 bal = collateralBalances[_user][t];
            if (bal == 0) continue;
            uint256 tokenValue = (bal * _getTokenPriceUSD(t)) / (10 ** COLLATERAL_DECIMALS);
            uint256 seizeValue = (tokenValue * valueToSeize) / totalCollValue;
            uint256 seizeAmount = (seizeValue * (10 ** COLLATERAL_DECIMALS)) / _getTokenPriceUSD(t);
            if (seizeAmount > bal) seizeAmount = bal;
            if (seizeAmount == 0) continue;

            collateralBalances[_user][t] -= seizeAmount;
            IERC20(t).transfer(msg.sender, seizeAmount);
        }

        emit Liquidated(_user, msg.sender, debtToRepay);

        if (msg.value > debtToRepay) {
            (bool refund,) = payable(msg.sender).call{value: msg.value - debtToRepay}("");
            require(refund, "Refund failed");
        }
    }

    function _getMaxBorrow(address _user) internal view returns (uint256) {
        uint256 collValue = _getCollateralValueUSD(_user);
        return (collValue * collateralFactor) / 100;
    }

    function getLoanDetails(address _user) external view returns (uint256 amount, uint256 lastAccrueTime, bool isActive) {
        Loan memory loan = loans[_user];
        return (loan.amount, loan.lastAccrueTime, loan.isActive);
    }

    function getLoanDebtWithAccrued(address _user) external view returns (uint256) {
        Loan memory loan = loans[_user];
        if (!loan.isActive || loan.amount == 0) return 0;
        uint256 elapsed = block.timestamp - loan.lastAccrueTime;
        if (elapsed == 0) return loan.amount;
        uint256 rate = getCurrentBorrowRate();
        uint256 interest = (loan.amount * rate * elapsed) / (RATE_PRECISION * SECONDS_PER_YEAR);
        return loan.amount + interest;
    }

    function getMaxBorrow(address _user) external view returns (uint256) {
        return _getMaxBorrow(_user);
    }

    function getHealthFactor(address _user) external view returns (uint256) {
        return _getHealthFactor(_user);
    }

    function getCollateralBalance(address _user, address _token) external view returns (uint256) {
        return collateralBalances[_user][_token];
    }

    function getCollateralValueUSD(address _user) external view returns (uint256) {
        return _getCollateralValueUSD(_user);
    }

    function poolBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getUtilization() external view returns (uint256) {
        if (totalSuppliedETH == 0) return 0;
        return (totalBorrowedETH * RATE_PRECISION) / totalSuppliedETH;
    }

    receive() external payable {}
}
