const VolatileToken = artifacts.require("VolatileToken");
const StableToken = artifacts.require("StableToken");
const MockPriceOracle = artifacts.require("MockPriceOracle");
const MoneyMarket = artifacts.require("MoneyMarket");

module.exports = async function(deployer) {
  // Deploy tokens
  await deployer.deploy(VolatileToken);
  await deployer.deploy(StableToken);
  
  const vlToken = await VolatileToken.deployed();
  const sbToken = await StableToken.deployed();
  
  // Deploy price oracle
  await deployer.deploy(MockPriceOracle);
  const priceOracle = await MockPriceOracle.deployed();
  
  // Deploy money market with token addresses
  await deployer.deploy(MoneyMarket, vlToken.address, sbToken.address, priceOracle.address);
  const moneyMarket = await MoneyMarket.deployed();
  
  console.log("VolatileToken deployed at:", vlToken.address);
  console.log("StableToken deployed at:", sbToken.address);
  console.log("MockPriceOracle deployed at:", priceOracle.address);
  console.log("MoneyMarket deployed at:", moneyMarket.address);
};