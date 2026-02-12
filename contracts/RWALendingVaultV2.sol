// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./AggregatorV3Interface.sol";

/**
 * RWA Lending Vault V2 - Oracle pricing + automated liquidations
 * - Optional Chainlink price feed: pass address(0) for testnet (1:1 fallback)
 * - Health factor: collateral value must stay above liquidation threshold (e.g. 125%)
 * - Liquidation: anyone can liquidate underwater loans for a fee (e.g. 5% bonus)
 */
contract RWALendingVaultV2 is Ownable {
    struct Loan {
        uint256 amount;
        uint256 collateral;
        bool isActive;
    }

    IERC20 public immutable collateralToken;
    AggregatorV3Interface public immutable priceFeed;
    uint256 public collateralFactor;      // e.g. 50 = 50% LTV
    uint256 public liquidationThreshold; // e.g. 125 = liquidate when collateral value < 125% of loan
    uint256 public liquidationBonus;     // e.g. 5 = liquidator gets 5% bonus

    mapping(address => uint256) public collateralBalances;
    mapping(address => Loan) public loans;

    uint256 private constant PRICE_FEED_DECIMALS = 8;
    uint256 private constant COLLATERAL_DECIMALS = 18;

    event CollateralDeposited(address indexed user, uint256 amount);
    event CollateralWithdrawn(address indexed user, uint256 amount);
    event LoanTaken(address indexed user, uint256 amount);
    event LoanRepaid(address indexed user, uint256 amount);
    event Liquidated(address indexed user, address indexed liquidator, uint256 collateralSeized, uint256 debtRepaid);

    constructor(
        IERC20 _collateralToken,
        AggregatorV3Interface _priceFeed,
        uint256 _collateralFactor,
        uint256 _liquidationThreshold,
        uint256 _liquidationBonus
    ) Ownable(msg.sender) {
        require(_collateralFactor <= 100, "Collateral factor must be <= 100");
        require(_liquidationThreshold >= 100 && _liquidationThreshold <= 200, "Liquidation threshold 100-200");
        require(_liquidationBonus <= 50, "Liquidation bonus <= 50");
        collateralToken = _collateralToken;
        priceFeed = _priceFeed;
        collateralFactor = _collateralFactor;
        liquidationThreshold = _liquidationThreshold;
        liquidationBonus = _liquidationBonus;
    }

    function depositLendingPool() external payable onlyOwner {}

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

    function _getCollateralValueUSD(uint256 _collateralAmount) internal view returns (uint256) {
        if (address(priceFeed) == address(0)) {
            return _collateralAmount;
        }
        (, int256 price,,,) = priceFeed.latestRoundData();
        require(price > 0, "Invalid price");
        return (uint256(uint256(price) * _collateralAmount)) / (10 ** PRICE_FEED_DECIMALS);
    }

    function _getMaxBorrow(address _user) internal view returns (uint256) {
        uint256 coll = collateralBalances[_user];
        if (coll == 0) return 0;
        uint256 collValueUSD = _getCollateralValueUSD(coll);
        return (collValueUSD * collateralFactor) / 100;
    }

    function _getHealthFactor(address _user) internal view returns (uint256) {
        Loan memory userLoan = loans[_user];
        if (!userLoan.isActive || userLoan.amount == 0) return type(uint256).max;
        uint256 collValue = _getCollateralValueUSD(userLoan.collateral);
        uint256 debtValue = userLoan.amount;
        if (debtValue == 0) return type(uint256).max;
        return (collValue * 100) / (debtValue * liquidationThreshold / 100);
    }

    function depositCollateral(uint256 _amount) external {
        require(_amount > 0, "Amount must be greater than zero");
        collateralBalances[msg.sender] += _amount;
        collateralToken.transferFrom(msg.sender, address(this), _amount);
        emit CollateralDeposited(msg.sender, _amount);
    }

    function withdrawCollateral(uint256 _amount) external {
        require(_amount > 0, "Amount must be greater than zero");
        require(collateralBalances[msg.sender] >= _amount, "Insufficient collateral");
        uint256 maxWithdrawable = collateralBalances[msg.sender] - _loanRequiredCollateral(msg.sender);
        require(_amount <= maxWithdrawable, "Cannot withdraw collateral locked for a loan");
        collateralBalances[msg.sender] -= _amount;
        collateralToken.transfer(msg.sender, _amount);
        emit CollateralWithdrawn(msg.sender, _amount);
    }

    function takeLoan(uint256 _amount) external {
        require(_amount > 0, "Amount must be greater than zero");
        require(!loans[msg.sender].isActive, "Existing loan must be repaid first");
        uint256 maxLoan = _getMaxBorrow(msg.sender);
        require(_amount <= maxLoan, "Loan exceeds collateral limit");
        require(address(this).balance >= _amount, "Insufficient lending pool balance");
        loans[msg.sender] = Loan({
            amount: _amount,
            collateral: collateralBalances[msg.sender],
            isActive: true
        });
        payable(msg.sender).transfer(_amount);
        emit LoanTaken(msg.sender, _amount);
    }

    function repayLoan() external payable {
        uint256 _amount = msg.value;
        require(_amount > 0, "Amount must be greater than zero");
        Loan storage userLoan = loans[msg.sender];
        require(userLoan.isActive, "No active loan");
        require(_amount <= userLoan.amount, "Repay amount exceeds loan");
        userLoan.amount -= _amount;
        if (userLoan.amount == 0) {
            userLoan.isActive = false;
        }
        emit LoanRepaid(msg.sender, _amount);
    }

    /**
     * Liquidate underwater position. Liquidator repays user's debt (sends ETH via msg.value)
     * and receives collateral + bonus. ETH stays in pool.
     */
    function liquidate(address _user) external payable {
        Loan storage userLoan = loans[_user];
        require(userLoan.isActive, "No active loan");
        uint256 hf = _getHealthFactor(_user);
        require(hf < 100, "Position not liquidatable");

        uint256 debtToRepay = userLoan.amount < msg.value ? userLoan.amount : msg.value;
        require(debtToRepay > 0, "Must send ETH to repay debt");

        uint256 collateralToSeize = (debtToRepay * userLoan.collateral) / userLoan.amount;
        collateralToSeize = (collateralToSeize * (100 + liquidationBonus)) / 100;
        if (collateralToSeize > userLoan.collateral) collateralToSeize = userLoan.collateral;

        userLoan.amount -= debtToRepay;
        if (userLoan.amount == 0) userLoan.isActive = false;
        collateralBalances[_user] -= collateralToSeize;

        collateralToken.transfer(msg.sender, collateralToSeize);

        if (msg.value > debtToRepay) {
            (bool refund,) = msg.sender.call{value: msg.value - debtToRepay}("");
            require(refund, "Refund failed");
        }

        emit Liquidated(_user, msg.sender, collateralToSeize, debtToRepay);
    }

    function _loanRequiredCollateral(address _user) internal view returns (uint256) {
        Loan memory userLoan = loans[_user];
        if (!userLoan.isActive) return 0;
        return (userLoan.amount * 100) / collateralFactor;
    }

    function getLoanDetails(address _user) external view returns (uint256 amount, uint256 collateral, bool isActive) {
        Loan memory userLoan = loans[_user];
        return (userLoan.amount, userLoan.collateral, userLoan.isActive);
    }

    function getMaxBorrow(address _user) external view returns (uint256) {
        return _getMaxBorrow(_user);
    }

    function getHealthFactor(address _user) external view returns (uint256) {
        return _getHealthFactor(_user);
    }

    function getCollateralValueUSD(uint256 _amount) external view returns (uint256) {
        return _getCollateralValueUSD(_amount);
    }

    function poolBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function withdrawExcessETH(uint256 _amount) external onlyOwner {
        require(address(this).balance >= _amount, "Insufficient balance");
        payable(owner()).transfer(_amount);
    }

    receive() external payable {}
}
