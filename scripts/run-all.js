const VolatileToken = artifacts.require("VolatileToken");
const StableToken = artifacts.require("StableToken");
const MockPriceOracle = artifacts.require("MockPriceOracle");
const MoneyMarket = artifacts.require("MoneyMarket");

module.exports = async function(callback) {
  try {
    console.log("🎯 Starting Complete Money Market Deployment & Setup...");
    
    // Deploy contracts
    console.log("📦 Deploying contracts...");
    const vlToken = await VolatileToken.new();
    const sbToken = await StableToken.new();
    const priceOracle = await MockPriceOracle.new();
    const moneyMarket = await MoneyMarket.new(vlToken.address, sbToken.address, priceOracle.address);
    
    console.log("✅ Contracts deployed");
    
    // Rest of setup code from setup.js...
    const accounts = await web3.eth.getAccounts();
    const owner = accounts[0];
    const generalUsers = accounts.slice(1, 11);
    const liquidators = accounts.slice(11, 16);
    
    // Set prices
    await priceOracle.setAssetPrice(vlToken.address, web3.utils.toWei('100', 'ether'));
    await priceOracle.setAssetPrice(sbToken.address, web3.utils.toWei('1', 'ether'));
    
    // Distribute tokens
    for (let user of [...generalUsers, ...liquidators]) {
      await vlToken.transfer(user, web3.utils.toWei('1000', 'ether'), { from: owner });
      await sbToken.transfer(user, web3.utils.toWei('1000', 'ether'), { from: owner });
      await vlToken.approve(moneyMarket.address, web3.utils.toWei('10000', 'ether'), { from: user });
      await sbToken.approve(moneyMarket.address, web3.utils.toWei('10000', 'ether'), { from: user });
    }
    
    console.log("🎉 Everything setup successfully!");
    console.log("\n📍 Contract Addresses:");
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