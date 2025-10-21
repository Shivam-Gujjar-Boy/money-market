const VolatileToken = artifacts.require("VolatileToken");
const StableToken = artifacts.require("StableToken");
const MockPriceOracle = artifacts.require("MockPriceOracle");
const MoneyMarket = artifacts.require("MoneyMarket");

module.exports = async function(callback) {
  try {
    console.log("🧪 Testing Basic Money Market Functions...");
    
    const vlToken = await VolatileToken.deployed();
    const sbToken = await StableToken.deployed();
    const priceOracle = await MockPriceOracle.deployed();
    const moneyMarket = await MoneyMarket.deployed();
    
    const accounts = await web3.eth.getAccounts();
    const user = accounts[1]; // First general user
    
    console.log("Testing with user:", user);
    
    // Test 1: Deposit
    console.log("\n1. Testing deposit...");
    await moneyMarket.deposit(web3.utils.toWei('10', 'ether'), { from: user });
    const collateral = await moneyMarket.collateralBalances(user);
    console.log("   Deposited 10 VLToken, Collateral:", web3.utils.fromWei(collateral));
    
    // Test 2: Check borrowing power
    console.log("\n2. Checking borrowing power...");
    const borrowingPower = await moneyMarket.getBorrowingPower(user);
    console.log("   Borrowing Power: $" + web3.utils.fromWei(borrowingPower));
    
    // Test 3: Borrow
    console.log("\n3. Testing borrow...");
    await moneyMarket.borrow(web3.utils.toWei('500', 'ether'), { from: user });
    const debt = await moneyMarket.debtBalances(user);
    console.log("   Borrowed 500 SBToken, Debt:", web3.utils.fromWei(debt));
    
    // Test 4: Check health factor
    console.log("\n4. Checking health factor...");
    const healthFactor = await moneyMarket.getHealthFactor(user);
    console.log("   Health Factor:", web3.utils.fromWei(healthFactor));
    
    // Test 5: Repay
    console.log("\n5. Testing repay...");
    await moneyMarket.repay(web3.utils.toWei('200', 'ether'), { from: user });
    const newDebt = await moneyMarket.debtBalances(user);
    console.log("   Repaid 200 SBToken, Remaining Debt:", web3.utils.fromWei(newDebt));
    
    console.log("\n✅ All basic tests passed!");
    
    callback();
  } catch (error) {
    console.error("❌ Test failed:", error);
    callback(error);
  }
};