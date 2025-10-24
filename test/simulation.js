const MoneyMarket = artifacts.require("MoneyMarket");
const VolatileToken = artifacts.require("VolatileToken");
const StableToken = artifacts.require("StableToken");
const MockPriceOracle = artifacts.require("MockPriceOracle");
const fs = require('fs');
const path = require('path');

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
    await sbToken.mint(mm.address, toWei("10000000", "ether"), { from: owner });
  });

  it("Run Simulation", async () => {
    const N = Math.floor(Math.random() * (200 - 50 + 1)) + 50;
    console.log(`Starting simulation with ${N} transactions...`);

    // History arrays for metrics (push after each tx)
    let tvlHist = [];
    let debtHist = [];
    let avgHfHist = [];
    let cumLiqHist = [];
    let underDebtHist = [];
    let cumLiq = BN(0); // Running total liquidation USD

    // Labels for x-axis
    let labels = [];

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
        const price = await oracle.getAssetPrice(sbToken.address);
        const amt = bp.mul(BN(Math.floor(pct * 100))).div(BN(100)).div(BN(price)).mul(BN(toWei("1", "ether")));
        const debt = await mm.getDebtValue(user);
        if (amt.gt(BN(0)) && debt.add(amt.mul(BN(price)).div(BN(toWei("1", "ether")))).lte(bp)) {
          txHash = await mm.borrow(amt, { from: user });
          logMsg = `Tx ${i}: User ${user} borrowed ${fromWei(amt)} SB`;
        } else logMsg = `Tx ${i}: User ${user} borrow skipped (no power)`;

      } else if (funcIdx === 2) { // Repay
        const user = users[Math.floor(Math.random() * users.length)];
        const debtBal = await mm.debtBalances(user);
        const pct = 0.2 + Math.random() * 0.8; // 20-100%
        const amt = debtBal.mul(BN(Math.floor(pct * 100))).div(BN(100));
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
              const closeFactorBp = await mm.closeFactor(); // 5000 bp
              const maxClose = debt.mul(closeFactorBp).div(BN(10000));
              const debtAmt = maxClose.gt(debt) ? debt : maxClose; // Min of maxClose and debt
              await sbToken.transfer(liq, debtAmt, { from: owner }); // Fund liq
              await sbToken.approve(mm.address, debtAmt, { from: liq });
              const sbPrice = await oracle.getAssetPrice(sbToken.address);
              const liqUsd = debtAmt.mul(BN(sbPrice)).div(BN(toWei("1", "ether")));
              cumLiq = cumLiq.add(liqUsd);
              txHash = await mm.liquidate(u, debtAmt, { from: liq });
              logMsg = `Tx ${i}: Liq ${liq} liquidated ${fromWei(debtAmt)} of user ${u} (${fromWei(liqUsd)} USD)`;
              liquidated = true;
              break;
            }
          }
        }
        if (!liquidated) logMsg = `Tx ${i}: Liq ${liq} scanned, no liquidations`;

      } else if (funcIdx === 4) { // Market Crash
        const currentPrice = await oracle.getAssetPrice(vlToken.address);
        const pctDrop = 0.3 + Math.random() * 0.3; // 30-60%
        const dropPct = Math.floor(pctDrop * 100);
        const newPrice = currentPrice.mul(BN(100 - dropPct)).div(BN(100));
        txHash = await oracle.setAssetPrice(vlToken.address, newPrice, { from: owner });
        logMsg = `Tx ${i}: Owner crashed VL price to ${fromWei(newPrice)} USD (${(100 - dropPct)}% of prev)`;

      } else { // Market Gain
        const currentPrice = await oracle.getAssetPrice(vlToken.address);
        const pctGain = 0.2 + Math.random() * 0.6; // 20-80%
        const gainPct = Math.floor(pctGain * 100);
        const newPrice = currentPrice.mul(BN(100 + gainPct)).div(BN(100));
        txHash = await oracle.setAssetPrice(vlToken.address, newPrice, { from: owner });
        logMsg = `Tx ${i}: Owner gained VL price to ${fromWei(newPrice)} USD (${(100 + gainPct)}% of prev)`;
      }

      console.log(logMsg);

      // Track metrics after each tx
      let totalTVL = BN(0);
      let totalDebt = BN(0);
      let avgHF = BN(0);
      let underDebt = BN(0);
      let borrowerCount = 0;
      for (let u of users) {
        const collVal = await mm.getCollateralValue(u);
        totalTVL = totalTVL.add(collVal);
        const debtVal = await mm.getDebtValue(u);
        totalDebt = totalDebt.add(debtVal);
        if (debtVal.gt(BN(0))) {
          const hf = await mm.getHealthFactor(u);
          avgHF = avgHF.add(hf);
          borrowerCount++;
          if (hf.lt(toWei("1", "ether"))) {
            underDebt = underDebt.add(debtVal);
          }
        }
      }
      if (borrowerCount > 0) {
        avgHF = avgHF.div(BN(borrowerCount));
      } else {
        avgHF = toWei("100", "ether"); // Arbitrary high if no borrowers
      }

      // Push to histories (as numbers for charting)
      labels.push(i);
      tvlHist.push(Number(fromWei(totalTVL)));
      debtHist.push(Number(fromWei(totalDebt)));
      avgHfHist.push(Number(fromWei(avgHF)));
      cumLiqHist.push(Number(fromWei(cumLiq)));
      underDebtHist.push(Number(fromWei(underDebt)));

      if (i % 10 === 0) console.log(`--- Progress: ${i}/${N} ---`);
    }

    // Final summary: Print user positions
    console.log("\n=== Final User Positions ===");
    for (let user of users) {
      const pos = await mm.getUserPosition(user);
      console.log(`User ${user}:`);
      console.log(`  Collateral = ${fromWei(pos[0])}`);
      console.log(`  Debt = ${fromWei(pos[1])}`);
      console.log(`  Health Factor = ${fromWei(pos[2])}`);
      console.log(`  Borrowing Power = ${fromWei(pos[3])}`);
      console.log('-----------------------------------------------------');
    }

    // Output final metrics summary
    console.log("\n=== Final Aggregate Metrics ===");
    console.log(`TVL: ${tvlHist[tvlHist.length - 1]} USD`);
    console.log(`Total Debt: ${debtHist[debtHist.length - 1]} USD`);
    console.log(`Avg Health Factor: ${avgHfHist[avgHfHist.length - 1]}`);
    console.log(`Cumulative Liquidations: ${cumLiqHist[cumLiqHist.length - 1]} USD`);
    console.log(`Under-collateralized Debt: ${underDebtHist[underDebtHist.length - 1]} USD`);

    // Generate HTML file with Chart.js visualization
    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MoneyMarket Simulation Results</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.9.1/chart.min.js"></script>
    <style>
        body {
            font-family: Arial, sans-serif;
            padding: 20px;
            background: #f5f5f5;
        }
        h1 {
            text-align: center;
            color: #333;
        }
        .chart-container {
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        canvas {
            max-height: 400px;
        }
        .metrics {
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .metrics h2 {
            margin-top: 0;
        }
        .metric-item {
            padding: 10px 0;
            border-bottom: 1px solid #eee;
        }
        .metric-item:last-child {
            border-bottom: none;
        }
    </style>
</head>
<body>
    <h1>MoneyMarket Simulation Results (${N} Transactions)</h1>
    
    <div class="metrics">
        <h2>Final Aggregate Metrics</h2>
        <div class="metric-item"><strong>TVL:</strong> ${tvlHist[tvlHist.length - 1].toFixed(2)} USD</div>
        <div class="metric-item"><strong>Total Debt:</strong> ${debtHist[debtHist.length - 1].toFixed(2)} USD</div>
        <div class="metric-item"><strong>Avg Health Factor:</strong> ${avgHfHist[avgHfHist.length - 1].toFixed(2)}</div>
        <div class="metric-item"><strong>Cumulative Liquidations:</strong> ${cumLiqHist[cumLiqHist.length - 1].toFixed(2)} USD</div>
        <div class="metric-item"><strong>Under-collateralized Debt:</strong> ${underDebtHist[underDebtHist.length - 1].toFixed(2)} USD</div>
    </div>

    <div class="chart-container">
        <canvas id="tvlChart"></canvas>
    </div>
    
    <div class="chart-container">
        <canvas id="debtChart"></canvas>
    </div>
    
    <div class="chart-container">
        <canvas id="hfChart"></canvas>
    </div>
    
    <div class="chart-container">
        <canvas id="liqChart"></canvas>
    </div>
    
    <div class="chart-container">
        <canvas id="underDebtChart"></canvas>
    </div>

    <script>
        const labels = ${JSON.stringify(labels)};
        const tvlData = ${JSON.stringify(tvlHist.map(d => Math.round(d * 100) / 100))};
        const debtData = ${JSON.stringify(debtHist.map(d => Math.round(d * 100) / 100))};
        const hfData = ${JSON.stringify(avgHfHist.map(d => Math.round(d * 100) / 100))};
        const liqData = ${JSON.stringify(cumLiqHist.map(d => Math.round(d * 100) / 100))};
        const underDebtData = ${JSON.stringify(underDebtHist.map(d => Math.round(d * 100) / 100))};

        const chartOptions = {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                y: { beginAtZero: true }
            }
        };

        new Chart(document.getElementById('tvlChart'), {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Total Value Locked (USD)',
                    data: tvlData,
                    borderColor: '#4CAF50',
                    backgroundColor: '#4CAF5020',
                    tension: 0.1
                }]
            },
            options: chartOptions
        });

        new Chart(document.getElementById('debtChart'), {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Total Outstanding Borrowings (USD)',
                    data: debtData,
                    borderColor: '#FF9800',
                    backgroundColor: '#FF980020',
                    tension: 0.1
                }]
            },
            options: chartOptions
        });

        new Chart(document.getElementById('hfChart'), {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Average Health Factor',
                    data: hfData,
                    borderColor: '#2196F3',
                    backgroundColor: '#2196F320',
                    tension: 0.1
                }]
            },
            options: chartOptions
        });

        new Chart(document.getElementById('liqChart'), {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Cumulative Liquidations (USD)',
                    data: liqData,
                    borderColor: '#F44336',
                    backgroundColor: '#F4433620',
                    tension: 0.1
                }]
            },
            options: chartOptions
        });

        new Chart(document.getElementById('underDebtChart'), {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Under-collateralized Debt (USD)',
                    data: underDebtData,
                    borderColor: '#9C27B0',
                    backgroundColor: '#9C27B020',
                    tension: 0.1
                }]
            },
            options: chartOptions
        });
    </script>
</body>
</html>
    `;

    // Write HTML file
    const outputPath = path.join(__dirname, '..', '../money_market_simulations/simulation_results_2.html');
    fs.writeFileSync(outputPath, htmlContent);
    console.log(`\n=== Visualization Generated ===`);
    console.log(`Open this file in your browser: ${outputPath}`);
  });
});