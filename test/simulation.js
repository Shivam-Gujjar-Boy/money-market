const MoneyMarket = artifacts.require("MoneyMarket");
const VolatileToken = artifacts.require("VolatileToken");
const StableToken = artifacts.require("StableToken");
const MockPriceOracle = artifacts.require("MockPriceOracle");

const BN = web3.utils.toBN;
const toWei = web3.utils.toWei;
const fromWei = web3.utils.fromWei;

contract("MoneyMarket Simulation", async (accounts) => {
  let mm, vlToken, sbToken, oracle;
  const owner = accounts[0];
  const users = accounts.slice(1, 11); // 10 normal users
  const liquidators = accounts.slice(11, 16); // 5 liquidators
  const AMOUNT = toWei("10000", "ether"); // Mint 10k each for simulation

  before(async () => {
    vlToken = await VolatileToken.deployed();
    sbToken = await StableToken.deployed();
    oracle = await MockPriceOracle.deployed();
    mm = await MoneyMarket.deployed();

    // Mint tokens to users and liquidators
    for (let user of [...users, ...liquidators]) {
      await vlToken.mint(user, AMOUNT, { from: owner });
      await sbToken.mint(user, AMOUNT, { from: owner });
    }

    // Approvals
    for (let user of users) {
      await vlToken.approve(mm.address, AMOUNT, { from: user });
      await sbToken.approve(mm.address, AMOUNT, { from: user });
    }
    for (let liq of liquidators) {
      await sbToken.approve(mm.address, AMOUNT, { from: liq });
    }

    // Initial prices: VL=2 USD, SB=1 USD (in 1e18)
    await oracle.setAssetPrice(vlToken.address, toWei("2", "ether"), { from: owner });
    await oracle.setAssetPrice(sbToken.address, toWei("1", "ether"), { from: owner });
  });

  // it("Le Bhai Laddar", async () => {
  //   for (let user of users) {
  //     const balance = await vlToken.balanceOf(user);
  //     const amount = balance.mul(BN(Math.floor(100))).div(BN(100));
  //     console.log(amount);
  //   }
  // })

  it("Run Simulation", async () => {
    const N = Math.floor(Math.random() * (200 - 50 + 1)) + 50;
    console.log(`Starting simulation with ${N} transactions...`);

    for (let i = 1; i <= N; i++) {
      // Random function: 0=deposit,1=borrow,2=repay,3=liquidate,4=crash,5=gain
      const funcIdx = Math.floor(Math.random() * 6);
      let txHash, logMsg;

      if (funcIdx === 0) { // Deposit
        const user = users[Math.floor(Math.random() * users.length)];
        const bal = await vlToken.balanceOf(user);
        const pct = 0.1 + Math.random() * 0.4; // 10-50%
        const amt = bal.mul(BN(Math.floor(pct * 100))).div(BN(100));
        if (amt.gt(BN(0))) {
          txHash = await mm.deposit(amt, { from: user });
          logMsg = `Tx ${i}: User ${user} deposited ${fromWei(amt)} VL`;
        } else logMsg = `Tx ${i}: User ${user} deposit skipped (low bal)`;

      } else if (funcIdx === 1) { // Borrow
        const user = users[Math.floor(Math.random() * users.length)];
        const bp = await mm.getBorrowingPower(user);
        const pct = 0.2 + Math.random() * 0.8; // 20-100%
        const amt = bp.mul(BN(Math.floor(pct * 100))).div(BN(100)).div(await oracle.getAssetPrice(sbToken.address)).mul(toWei("1", "ether")); // Adjust for price
        if (amt.gt(BN(0)) && (await mm.getDebtValue(user)).add(amt.mul(await oracle.getAssetPrice(sbToken.address)).div(toWei("1", "ether"))) <= bp) {
          txHash = await mm.borrow(amt, { from: user });
          logMsg = `Tx ${i}: User ${user} borrowed ${fromWei(amt)} SB`;
        } else logMsg = `Tx ${i}: User ${user} borrow skipped (no power)`;

      } else if (funcIdx === 2) { // Repay
        const user = users[Math.floor(Math.random() * users.length)];
        const debt = await mm.debtBalances(user);
        const pct = 0.2 + Math.random() * 0.8; // 20-100%
        const amt = debt.mul(BN(Math.floor(pct * 100))).div(BN(100));
        if (amt.gt(BN(0))) {
          await sbToken.transfer(user, amt, { from: owner }); // Ensure SB for repay
          await sbToken.approve(mm.address, amt, { from: user });
          txHash = await mm.repay(amt, { from: user });
          logMsg = `Tx ${i}: User ${user} repaid ${fromWei(amt)} SB`;
        } else logMsg = `Tx ${i}: User ${user} repay skipped (no debt)`;

      } else if (funcIdx === 3) { // Liquidate
        const liq = liquidators[Math.floor(Math.random() * liquidators.length)];
        let liquidated = false;
        for (let u of users) {
          const hf = await mm.getHealthFactor(u);
          if (hf.lt(toWei("1", "ether"))) {
            const debt = await mm.debtBalances(u);
            if (debt.gt(BN(0))) {
              const closeFactor = await mm.closeFactor(); // 5000 bp = 50%
              const maxClose = debt.mul(closeFactor).div(toWei("1", "ether")); // Adjust scale
              const debtAmt = BN(Math.min(Number(maxClose), Number(debt)));
              await sbToken.transfer(liq, debtAmt, { from: owner }); // Fund liq
              await sbToken.approve(mm.address, debtAmt, { from: liq });
              txHash = await mm.liquidate(u, debtAmt, { from: liq });
              logMsg = `Tx ${i}: Liq ${liq} liquidated ${fromWei(debtAmt)} of user ${u}`;
              liquidated = true;
              break;
            }
          }
        }
        if (!liquidated) logMsg = `Tx ${i}: Liq ${liq} scanned, no liquidations`;

      } else if (funcIdx === 4) { // Market Crash
        const currentPrice = await oracle.getAssetPrice(vlToken.address);
        const pctDrop = 0.3 + Math.random() * 0.3; // 30-60%
        const newPrice = currentPrice.mul(BN(100 - Math.floor(pctDrop * 100))).div(BN(100));
        txHash = await oracle.setAssetPrice(vlToken.address, newPrice, { from: owner });
        logMsg = `Tx ${i}: Owner crashed VL price to ${fromWei(newPrice)} USD (${(1-pctDrop)*100}% of prev)`;

      } else { // Market Gain
        const currentPrice = await oracle.getAssetPrice(vlToken.address);
        const pctGain = 0.2 + Math.random() * 0.6; // 20-80%
        const newPrice = currentPrice.mul(BN(100 + Math.floor(pctGain * 100))).div(BN(100));
        txHash = await oracle.setAssetPrice(vlToken.address, newPrice, { from: owner });
        logMsg = `Tx ${i}: Owner gained VL price to ${fromWei(newPrice)} USD (${(1+pctGain)*100}% of prev)`;
      }

      console.log(logMsg);
      if (i % 10 === 0) console.log(`--- Progress: ${i}/${N} ---`);
    }

    // Final summary: Print user positions
    console.log("\n=== Final User Positions ===");
    for (let user of users) {
      const pos = await mm.getUserPosition(user);
      console.log(`User ${user}: Coll ${fromWei(pos[0])}, Debt ${fromWei(pos[1])}, HF ${fromWei(pos[2])}, BP ${fromWei(pos[3])}`);
    }
  });
});