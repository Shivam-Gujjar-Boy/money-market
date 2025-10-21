// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

// Interface for MockPriceOracle
interface IPriceOracle {
    function getAssetPrice(address _asset) external view returns (uint256);
    function setAssetPrice(address _asset, uint256 _price) external;
}

contract MoneyMarket is Ownable {
    using SafeMath for uint256;

    // Token addresses
    address public vlToken;
    address public sbToken;
    address public priceOracle;

    // Protocol parameters
    uint256 public collateralFactor = 7000; // 70% in basis points
    uint256 public liquidationThreshold = 8000; // 80% in basis points
    uint256 public liquidationBonus = 500; // 5% in basis points
    uint256 public closeFactor = 5000; // 50% in basis points

    // User balances
    mapping(address => uint256) public collateralBalances;
    mapping(address => uint256) public debtBalances;

    // Events
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event Borrowed(address indexed user, uint256 amount);
    event Repaid(address indexed user, uint256 amount);
    event Liquidated(address indexed user, address indexed liquidator, uint256 debtRepaid, uint256 collateralSeized);

    constructor(address _vlToken, address _sbToken, address _priceOracle) {
        vlToken = _vlToken;
        sbToken = _sbToken;
        priceOracle = _priceOracle;
    }

    function setProtocolParameters(
        uint256 _collateralFactor,
        uint256 _liquidationThreshold,
        uint256 _liquidationBonus,
        uint256 _closeFactor
    ) external onlyOwner {
        collateralFactor = _collateralFactor;
        liquidationThreshold = _liquidationThreshold;
        liquidationBonus = _liquidationBonus;
        closeFactor = _closeFactor;
    }

    function getHealthFactor(address user) public view returns (uint256) {
        uint256 collateralValue = getCollateralValue(user);
        uint256 debtValue = getDebtValue(user);
        
        if (debtValue == 0) return type(uint256).max;
        
        return collateralValue.mul(liquidationThreshold).div(10000).mul(1e18).div(debtValue);
    }

    function getCollateralValue(address user) public view returns (uint256) {
        uint256 collateralBalance = collateralBalances[user];
        uint256 price = IPriceOracle(priceOracle).getAssetPrice(vlToken);
        return collateralBalance.mul(price).div(1e18);
    }

    function getDebtValue(address user) public view returns (uint256) {
        uint256 debtBalance = debtBalances[user];
        uint256 price = IPriceOracle(priceOracle).getAssetPrice(sbToken);
        return debtBalance.mul(price).div(1e18);
    }

    function getBorrowingPower(address user) public view returns (uint256) {
        uint256 collateralValue = getCollateralValue(user);
        return collateralValue.mul(collateralFactor).div(10000);
    }

    function deposit(uint256 amount) external {
        require(amount > 0, "Amount must be greater than 0");
        
        // Transfer tokens from user
        require(IERC20(vlToken).transferFrom(msg.sender, address(this), amount), "Transfer failed");
        
        // Update collateral balance
        collateralBalances[msg.sender] = collateralBalances[msg.sender].add(amount);
        
        emit Deposited(msg.sender, amount);
    }

    // function withdraw(uint256 amount) external {
    //     require(amount > 0, "Amount must be greater than 0");
    //     require(collateralBalances[msg.sender] >= amount, "Insufficient collateral");
        
    //     // Calculate health factor after withdrawal
    //     uint256 newCollateral = collateralBalances[msg.sender].sub(amount);
    //     uint256 tempCollateral = collateralBalances[msg.sender];
    //     collateralBalances[msg.sender] = newCollateral;
        
    //     uint256 healthFactor = getHealthFactor(msg.sender);
    //     require(healthFactor >= 1e18, "Health factor would drop below 1");
        
    //     // Restore original balance if check passes
    //     collateralBalances[msg.sender] = tempCollateral;
        
    //     // Update balance and transfer
    //     collateralBalances[msg.sender] = collateralBalances[msg.sender].sub(amount);
    //     require(IERC20(vlToken).transfer(msg.sender, amount), "Transfer failed");
        
    //     emit Withdrawn(msg.sender, amount);
    // }

    function borrow(uint256 amount) external {
        require(amount > 0, "Amount must be greater than 0");
        
        uint256 borrowingPower = getBorrowingPower(msg.sender);
        uint256 currentDebtValue = getDebtValue(msg.sender);
        uint256 borrowValue = amount.mul(IPriceOracle(priceOracle).getAssetPrice(sbToken)).div(1e18);
        
        require(currentDebtValue.add(borrowValue) <= borrowingPower, "Exceeds borrowing power");
        
        // Update debt balance
        debtBalances[msg.sender] = debtBalances[msg.sender].add(amount);
        
        // Transfer borrowed tokens
        require(IERC20(sbToken).transfer(msg.sender, amount), "Transfer failed");
        
        emit Borrowed(msg.sender, amount);
    }

    function repay(uint256 amount) external {
        require(amount > 0, "Amount must be greater than 0");
        require(debtBalances[msg.sender] >= amount, "Repay amount exceeds debt");
        
        // Transfer tokens from user
        require(IERC20(sbToken).transferFrom(msg.sender, address(this), amount), "Transfer failed");
        
        // Update debt balance
        debtBalances[msg.sender] = debtBalances[msg.sender].sub(amount);
        
        emit Repaid(msg.sender, amount);
    }

    function liquidate(address user, uint256 debtAmount) external {
        require(getHealthFactor(user) < 1e18, "Health factor must be below 1");
        require(debtAmount > 0, "Debt amount must be greater than 0");
        
        uint256 maxCloseAmount = debtBalances[user].mul(closeFactor).div(10000);
        uint256 actualCloseAmount = debtAmount > maxCloseAmount ? maxCloseAmount : debtAmount;
        
        require(actualCloseAmount <= debtBalances[user], "Cannot repay more than current debt");
        
        // Calculate collateral to seize
        uint256 debtValue = actualCloseAmount.mul(IPriceOracle(priceOracle).getAssetPrice(sbToken)).div(1e18);
        uint256 collateralValue = debtValue.mul(10000 + liquidationBonus).div(10000);
        uint256 collateralToSeize = collateralValue.mul(1e18).div(IPriceOracle(priceOracle).getAssetPrice(vlToken));
        
        require(collateralToSeize <= collateralBalances[user], "Insufficient collateral to seize");
        
        // Transfer debt repayment from liquidator
        require(IERC20(sbToken).transferFrom(msg.sender, address(this), actualCloseAmount), "Transfer failed");
        
        // Update balances
        debtBalances[user] = debtBalances[user].sub(actualCloseAmount);
        collateralBalances[user] = collateralBalances[user].sub(collateralToSeize);
        
        // Transfer collateral to liquidator
        require(IERC20(vlToken).transfer(msg.sender, collateralToSeize), "Transfer failed");
        
        emit Liquidated(user, msg.sender, actualCloseAmount, collateralToSeize);
    }

    function getUserPosition(address user) external view returns (
        uint256 collateral,
        uint256 debt,
        uint256 healthFactor,
        uint256 borrowingPower
    ) {
        collateral = collateralBalances[user];
        debt = debtBalances[user];
        healthFactor = getHealthFactor(user);
        borrowingPower = getBorrowingPower(user);
    }
}