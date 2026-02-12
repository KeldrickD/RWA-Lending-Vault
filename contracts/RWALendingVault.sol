// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract RWALendingVault is Ownable {
    struct Loan {
        uint256 amount;
        uint256 collateral;
        bool isActive;
    }

    IERC20 public immutable collateralToken;
    uint256 public collateralFactor;

    mapping(address => uint256) public collateralBalances;
    mapping(address => Loan) public loans;

    event CollateralDeposited(address indexed user, uint256 amount);
    event CollateralWithdrawn(address indexed user, uint256 amount);
    event LoanTaken(address indexed user, uint256 amount);
    event LoanRepaid(address indexed user, uint256 amount);

    constructor(IERC20 _collateralToken, uint256 _collateralFactor) Ownable(msg.sender) {
        require(_collateralFactor <= 100, "Collateral factor must be <= 100");
        collateralToken = _collateralToken;
        collateralFactor = _collateralFactor;
    }

    function depositLendingPool() external payable onlyOwner {}

    function setCollateralFactor(uint256 _newFactor) external onlyOwner {
        require(_newFactor <= 100, "Collateral factor must be <= 100");
        collateralFactor = _newFactor;
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
        require(loans[msg.sender].isActive == false, "Existing loan must be repaid first");
        uint256 maxLoan = (collateralBalances[msg.sender] * collateralFactor) / 100;
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
        return (collateralBalances[_user] * collateralFactor) / 100;
    }

    function poolBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function withdrawExcessETH(uint256 _amount) external onlyOwner {
        require(address(this).balance >= _amount, "Insufficient balance");
        payable(owner()).transfer(_amount);
    }
}
