# Akahu-Firefly

Connect your NZ Bank accounts directly into [Firefly III](https://www.firefly-iii.org/) through [Akahu](https://akahu.nz).

## Installation

1. Clone the git repo locally
2. `npm i` to install dependencies

## Setup

1. Ensure that the "Account Number" field on your accounts within Firefly is set to the 16-digit account number from your bank.
For example, `00-0000-0000000-00`. Depending on your bank, you may need to trail with three digits rather than two.
2. Setup a personal app & user token within Akahu, linking all accounts you want to appear within Firefly.
These accounts need to already exist in Firefly.
3. Create a personal access token within Firefly.
4. Copy file `config.json.template` to `config.json` and populate with Akahu secrets, and Firefly secrets
5. Run `node index.js config.json` on a schedule, either with systemd timers, cron or some other scheduling system


### Transfers

If you move money between accounts, you may notice these are double-entered.
My advise is to delete one of these transactions with transaction rules within Firefly.

