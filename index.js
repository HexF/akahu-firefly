const process = require("process")
const path = require("path")
const configPath = path.resolve(process.argv.slice(-1)[0] || "config.json")
console.log("loading config from", configPath)

const {akahu: {appToken, userToken, importWeeks}, firefly: {endpoint: fireflyEndpoint, accessToken: fireflyPersonalAccessToken}} = require(configPath);

const axios = require('axios');
const { AkahuClient } = require('akahu');
const akahu = new AkahuClient({ appToken });

const firefly = axios.create({
    baseURL: fireflyEndpoint,
    timeout: 10000,
    headers: {
        'Authorization': `Bearer ${fireflyPersonalAccessToken}`
    }
});

(async function(){
    await akahu.accounts.refreshAll(userToken);

    const accounts = await akahu.accounts.list(userToken);

    const accountLinks = {};
    const accountNumberLinks = {};
    const ownAccounts = [];



    let page = 1;
    do{
        const {data: {data: fireflyAccounts, meta}} = await firefly.get(`/api/v1/accounts?page=${page}`)


        for(const account of fireflyAccounts){
            const id = account.id;
            if(account.attributes.account_number !== null){
                accountNumberLinks[account.attributes.account_number] = id;

                for(const akahuAccount of accounts){
                    const {_id: akahuId, formatted_account: accountNumber} = akahuAccount;
                    if(accountNumber === account.attributes.account_number){
                        accountLinks[akahuId] = id;
                        ownAccounts.push(id)
                    }
                }
            }

            if(account.attributes.notes !== null){
                const matches = account.attributes.notes.matchAll(/Akahu Id: (\S+)/gm);

                for(const match of matches){
                    accountLinks[match[1]] = id;

                    if(match[1].startsWith("acc_")){
                        ownAccounts.push(id)
                    }
                }
            }
        }

        page = meta.pagination.current_page + 1;
        if(page > meta.pagination.total_pages) break;
    } while(true)

    console.log("Account linkages: ", accountLinks)
    
    const query = {
        start: new Date(Date.now() - 604800000 * importWeeks).toISOString(), // 1 week ago
        end: new Date().toISOString()
    };

    do{
        const page = await akahu.transactions.list(userToken, query);
        query.cursor = page.cursor.next;

        for(const transaction of page.items){
            const {_id: id, _account: accountId, date, amount, description, merchant, type, meta} = transaction;

            let addMerchant = false;
            let addOtherAccount = false;

            if(accountLinks[accountId] === undefined){
                console.log("Skipped - account not found")
                continue;
            }

            if(amount === 0){
                console.log("Skipped - Zero Amount");
                continue;
            }

            let fireflyTransaction = {
                type: (
                    amount > 0 ? "deposit" : "withdrawal"
                ),
                payment_date: date,
                date,
                amount: Math.abs(amount).toFixed(2),
                description,
                reconciled: true,
                external_id: id,
                notes: `Imported From Akahu\nAkahu Type: ${type}\n`
            };

            fireflyTransaction[amount < 0 ? "source_id" : "destination_id"] = accountLinks[accountId];

            if(merchant !== undefined) {
                if(accountLinks[merchant._id] !== undefined)
                    fireflyTransaction[amount > 0 ? "source_id" : "destination_id"] = accountLinks[merchant._id];
                    if(ownAccounts.includes(accountLinks[merchant._id])){
                        fireflyTransaction["type"] = "transfer";
                    }
                else{
                    fireflyTransaction[amount > 0 ? "source_name" : "destination_name"] = `${merchant.name} (${merchant._id})`;
                    addMerchant = true;
                }
            }

            if(meta !== undefined){
                const {conversion, particulars, code, reference, other_account} = meta;
                if(conversion !== undefined){
                    fireflyTransaction["foreign_currency_code"] = conversion.currency;
                    fireflyTransaction["foreign_amount"] = conversion.amount;
                }

                if(particulars !== undefined)
                    fireflyTransaction["notes"] += `Particulars: ${particulars}\n`;
                
                if(code !== undefined)
                    fireflyTransaction["notes"] += `Code: ${code}\n`;

                if(reference !== undefined)
                    fireflyTransaction["notes"] += `Reference: ${reference}\n`;

                if(other_account !== undefined){
                    fireflyTransaction["notes"] += `Other Account: ${other_account}\n`;

                    if(accountNumberLinks[other_account] !== undefined){
                        fireflyTransaction[amount > 0 ? "source_id" : "destination_id"] = accountNumberLinks[other_account];
                        if(ownAccounts.includes(accountNumberLinks[other_account])){
                            fireflyTransaction["type"] = "transfer";
                        }
                    }else{
                        fireflyTransaction[amount > 0 ? "source_name" : "destination_name"] = other_account;
                        addOtherAccount = true;
                    }
                }
                
            }

            try{
                const response = await firefly.post("/api/v1/transactions", {
                    error_if_duplicate_hash: true,
                    apply_rules: true,
                    fire_webhooks: true,
                    transactions: [fireflyTransaction]
                })

                console.log(`(${id} ${accountId}) ${date} $${amount} ${type} ${description}`)
                
                if(addMerchant || addOtherAccount){
                    const fireflyAccountId = response.data.data.attributes[amount > 0 ? "source_id" : "destination_id"];
                    // TODO: add Akahu Id to Notes

                }

                
            }catch(err){
                if(err.response.data.message.includes("Duplicate of transaction #")){
                    console.log("Skipping - Already imported")
                    continue;
                }

                console.log("Failed to add transaction:")
                console.log({
                    akahu: transaction,
                    firefly: fireflyTransaction,
                    response: err.response.data
                })

            }

                
            
            
        }

    }while(query.cursor !== null)
})()
