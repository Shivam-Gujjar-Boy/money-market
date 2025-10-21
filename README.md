# DeFi Money Market Protocol (CS765 HW2)

## Project Overview

This project implements a decentralized finance (DeFi) money market protocol on Ethereum, acting as an autonomous lending and borrowing platform. Users deposit collateral (VolatileToken, VLToken) to borrow stable assets (StableToken, SBToken) with over-collateralization for risk management. Key features include:

- **Health Factor Calculation**: Monitors loan safety (H > 1 healthy; H < 1 liquidatable) using a mock price oracle for USD valuations.
- **Core Mechanics**: Deposit/withdraw collateral, borrow/repay loans, and liquidate under-collateralized positions with bonuses and close factors.
- **Simulation**: A Truffle test script runs random transactions (deposits, borrows, repays, liquidations, market crashes/gains) over 50-200 iterations, tracking aggregates like TVL, total debt, average health factor, cumulative liquidations, and under-collateralized debt. Outputs metrics and Chart.js configs for visualization.

Built with Solidity ^0.8.0, OpenZeppelin, Truffle, and Ganache for local testing. No interest or fees (per assignment specs). Total points: 100.

## Setup and Running

### Prerequisites
- Node.js (v14+)
- Truffle (`npm install -g truffle`)
- Ganache CLI (`npm install -g ganache-cli`)

### Steps
1. **Clone the Repo**:
```bash
git clone https://Shivam-Gujjar-Boy/money-market.git
cd money-market
```

2. **Install Dependencies**:
```bash
npm install
```


3. **Start Local Blockchain** (Ganache with 16 accounts for sim):
```bash
ganache-cli -a 16 -e 100000000000000000000  # 100 ETH each
```
(Leave running in one terminal.)

4. **Compile Contracts**:
```bash
truffle compile
```

5. **Deploy to Ganache**:
```bash
truffle migrate
```
(Check console for addresses.)

6. **Run Simulation** (tracks metrics, logs charts):
```bash
truffle test test/simulation.js
```
(Outputs tx logs, final positions, aggregates; creates `simulation-report.html` in root with full details and embedded charts.)

### Notes
- Approvals/mints handled in sim; adjust `AMOUNT` if needed.
- For custom params, call `setProtocolParameters` on MoneyMarket (owner only).
- Debug: `truffle console` for interactive queries.

Questions? Review `contracts/` and `test/simulation.js`.