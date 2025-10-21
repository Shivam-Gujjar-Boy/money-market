const VolatileToken = artifacts.require("VolatileToken");
const StableToken = artifacts.require("StableToken");
const MockPriceOracle = artifacts.require("MockPriceOracle");
const MoneyMarket = artifacts.require("MoneyMarket");

module.exports = async function(callback) {
  try {
    console.log("🚀 Starting Money Market Setup...");
    
    // Get deployed contracts
    const vlToken = await VolatileToken.deployed();
    const sbToken = await StableToken.deployed();
    const priceOracle = await MockPriceOracle.deployed();
    const moneyMarket = await MoneyMarket.deployed();
    
    console.log("✅ Contracts loaded");
    
    // Get accounts
    const accounts = await web3.eth.getAccounts();
    const owner = accounts[0];
    const generalUsers = accounts.slice(1, 11); // 10 users
    const liquidators = accounts.slice(11, 16); // 5 liquidators
    
    console.log("👥 Accounts setup:");
    console.log("   Owner:", owner);
    console.log("   General Users:", generalUsers.length);
    console.log("   Liquidators:", liquidators.length);
    
    // Set initial prices
    console.log("💰 Setting token prices...");
    await priceOracle.setAssetPrice(vlToken.address, web3.utils.toWei('100', 'ether'));
    await priceOracle.setAssetPrice(sbToken.address, web3.utils.toWei('1', 'ether'));
    
    // Verify prices
    const vlPrice = await priceOracle.getAssetPrice(vlToken.address);
    const sbPrice = await priceOracle.getAssetPrice(sbToken.address);
    console.log("   VLToken Price: $" + web3.utils.fromWei(vlPrice));
    console.log("   SBToken Price: $" + web3.utils.fromWei(sbPrice));
    
    // Distribute VLToken to all users
    console.log("🪙 Distributing VLToken...");
    for (let user of [...generalUsers, ...liquidators]) {
      await vlToken.transfer(user, web3.utils.toWei('1000', 'ether'), { from: owner });
    }
    
    // Distribute SBToken to all users  
    console.log("🪙 Distributing SBToken...");
    for (let user of [...generalUsers, ...liquidators]) {
      await sbToken.transfer(user, web3.utils.toWei('1000', 'ether'), { from: owner });
    }
    
    // Set approvals for MoneyMarket
    console.log("✅ Setting token approvals...");
    for (let user of [...generalUsers, ...liquidators]) {
      await vlToken.approve(moneyMarket.address, web3.utils.toWei('10000', 'ether'), { from: user });
      await sbToken.approve(moneyMarket.address, web3.utils.toWei('10000', 'ether'), { from: user });
    }
    
    console.log("🎉 Setup completed successfully!");
    console.log("\n📊 Contract Addresses:");
    console.log("   VLToken:", vlToken.address);
    console.log("   SBToken:", sbToken.address);
    console.log("   PriceOracle:", priceOracle.address);
    console.log("   MoneyMarket:", moneyMarket.address);
    
    callback();
  } catch (error) {
    console.error("❌ Setup failed:", error);
    callback(error);
  }
};