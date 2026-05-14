#![no_std]

use soroban_sdk::{
    contract, contractimpl, map, symbol_short, Address, Env, Map, String, Vec,
};

#[cfg(test)]
mod test;

#[contract]
pub struct MoneyDigital;

#[contractimpl]
impl MoneyDigital {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().persistent().get::<_, Address>(&symbol_short!("admin")).is_some() {
            panic!("already initialized");
        }
        env.storage().persistent().set(&symbol_short!("admin"), &admin);
        env.storage().persistent().set(&symbol_short!("supply"), &String::from_str(&env, "0"));
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage().persistent().get(&symbol_short!("admin")).unwrap()
    }

    pub fn is_initialized(env: Env) -> bool {
        env.storage().persistent().get::<_, Address>(&symbol_short!("admin")).is_some()
    }

    pub fn register_wallet(env: Env, wallet: String, nombre: String, email: String) -> bool {
        let mut wallets: Map<String, Map<String, String>> = env
            .storage()
            .persistent()
            .get(&symbol_short!("wallets"))
            .unwrap_or_else(|| Map::new(&env));

        if wallets.get(wallet.clone()).is_some() {
            return false;
        }

        let wallet_data = map![
            &env,
            (String::from_str(&env, "nombre"), nombre),
            (String::from_str(&env, "email"), email),
            (String::from_str(&env, "balance"), String::from_str(&env, "0")),
        ];

        wallets.set(wallet.clone(), wallet_data);
        env.storage().persistent().set(&symbol_short!("wallets"), &wallets);
        true
    }

    pub fn get_wallet_info(env: Env, wallet: String) -> Option<Map<String, String>> {
        let wallets: Map<String, Map<String, String>> = env
            .storage()
            .persistent()
            .get(&symbol_short!("wallets"))
            .unwrap_or_else(|| Map::new(&env));
        wallets.get(wallet)
    }

    pub fn is_wallet_registered(env: Env, wallet: String) -> bool {
        let wallets: Map<String, Map<String, String>> = env
            .storage()
            .persistent()
            .get(&symbol_short!("wallets"))
            .unwrap_or_else(|| Map::new(&env));
        wallets.get(wallet).is_some()
    }

    pub fn get_balance(env: Env, wallet: String) -> String {
        let wallets: Map<String, Map<String, String>> = env
            .storage()
            .persistent()
            .get(&symbol_short!("wallets"))
            .unwrap_or_else(|| Map::new(&env));
        wallets
            .get(wallet)
            .and_then(|data| data.get(String::from_str(&env, "balance")))
            .unwrap_or_else(|| String::from_str(&env, "0"))
    }

    pub fn get_total_supply(env: Env) -> String {
        env.storage()
            .persistent()
            .get(&symbol_short!("supply"))
            .unwrap_or_else(|| String::from_str(&env, "0"))
    }

    pub fn transfer(env: Env, from: String, to: String, amount: String) -> bool {
        let mut wallets: Map<String, Map<String, String>> = env
            .storage()
            .persistent()
            .get(&symbol_short!("wallets"))
            .unwrap_or_else(|| Map::new(&env));

        let from_wallet = match wallets.get(from.clone()) {
            Some(w) => w,
            None => return false,
        };

        let from_balance = Self::str_to_i64(&env, &from_wallet.get(String::from_str(&env, "balance")).unwrap());
        let amount_i = Self::str_to_i64(&env, &amount);

        if amount_i <= 0 || from_balance < amount_i {
            return false;
        }

        let new_from_balance = Self::i64_to_str(&env, from_balance - amount_i);
        let mut updated_from = from_wallet.clone();
        updated_from.set(String::from_str(&env, "balance"), new_from_balance);
        wallets.set(from.clone(), updated_from);

        let to_wallet = wallets.get(to.clone()).unwrap_or_else(|| {
            map![&env, (String::from_str(&env, "balance"), String::from_str(&env, "0"))]
        });

        let to_balance = Self::str_to_i64(&env, &to_wallet.get(String::from_str(&env, "balance")).unwrap());
        let new_to_balance = Self::i64_to_str(&env, to_balance + amount_i);

        let mut updated_to = to_wallet.clone();
        updated_to.set(String::from_str(&env, "balance"), new_to_balance);
        wallets.set(to.clone(), updated_to);

        env.storage().persistent().set(&symbol_short!("wallets"), &wallets);

        Self::record_transaction(&env, from, to, amount, String::from_str(&env, "transfer"));
        true
    }

    pub fn mint(env: Env, admin: Address, wallet: String, amount: String) -> bool {
        let stored_admin: Address = env.storage().persistent().get(&symbol_short!("admin")).unwrap();
        if admin != stored_admin {
            return false;
        }

        let amount_i = Self::str_to_i64(&env, &amount);
        if amount_i <= 0 {
            return false;
        }

        let mut wallets: Map<String, Map<String, String>> = env
            .storage()
            .persistent()
            .get(&symbol_short!("wallets"))
            .unwrap_or_else(|| Map::new(&env));

        let wallet_data = wallets.get(wallet.clone()).unwrap_or_else(|| {
            map![&env, (String::from_str(&env, "balance"), String::from_str(&env, "0"))]
        });

        let balance = Self::str_to_i64(&env, &wallet_data.get(String::from_str(&env, "balance")).unwrap());
        let new_balance = Self::i64_to_str(&env, balance + amount_i);

        let mut updated = wallet_data.clone();
        updated.set(String::from_str(&env, "balance"), new_balance);
        wallets.set(wallet.clone(), updated);
        env.storage().persistent().set(&symbol_short!("wallets"), &wallets);

        let supply = env
            .storage()
            .persistent()
            .get(&symbol_short!("supply"))
            .unwrap_or_else(|| String::from_str(&env, "0"));
        let new_supply = Self::i64_to_str(&env, Self::str_to_i64(&env, &supply) + amount_i);
        env.storage().persistent().set(&symbol_short!("supply"), &new_supply);

        Self::record_transaction(
            &env,
            String::from_str(&env, "SYSTEM"),
            wallet,
            amount,
            String::from_str(&env, "mint"),
        );
        true
    }

    pub fn burn(env: Env, admin: Address, wallet: String, amount: String) -> bool {
        let stored_admin: Address = env.storage().persistent().get(&symbol_short!("admin")).unwrap();
        if admin != stored_admin {
            return false;
        }

        let amount_i = Self::str_to_i64(&env, &amount);
        if amount_i <= 0 {
            return false;
        }

        let mut wallets: Map<String, Map<String, String>> = env
            .storage()
            .persistent()
            .get(&symbol_short!("wallets"))
            .unwrap_or_else(|| Map::new(&env));

        let wallet_data = match wallets.get(wallet.clone()) {
            Some(w) => w,
            None => return false,
        };

        let balance = Self::str_to_i64(&env, &wallet_data.get(String::from_str(&env, "balance")).unwrap());
        if balance < amount_i {
            return false;
        }

        let new_balance = Self::i64_to_str(&env, balance - amount_i);
        let mut updated = wallet_data.clone();
        updated.set(String::from_str(&env, "balance"), new_balance);
        wallets.set(wallet.clone(), updated);
        env.storage().persistent().set(&symbol_short!("wallets"), &wallets);

        let supply = env.storage().persistent().get(&symbol_short!("supply")).unwrap();
        let new_supply = Self::i64_to_str(&env, Self::str_to_i64(&env, &supply) - amount_i);
        env.storage().persistent().set(&symbol_short!("supply"), &new_supply);

        Self::record_transaction(
            &env,
            wallet,
            String::from_str(&env, "SYSTEM"),
            amount,
            String::from_str(&env, "burn"),
        );
        true
    }

    fn record_transaction(env: &Env, from: String, to: String, amount: String, kind: String) {
        let mut txs: Vec<Map<String, String>> = env
            .storage()
            .persistent()
            .get(&symbol_short!("txs"))
            .unwrap_or_else(|| Vec::new(env));

        let tx = map![
            &env,
            (String::from_str(&env, "from"), from),
            (String::from_str(&env, "to"), to),
            (String::from_str(&env, "amount"), amount),
            (String::from_str(&env, "type"), kind)
        ];

        txs.push_back(tx);
        env.storage().persistent().set(&symbol_short!("txs"), &txs);
    }

    pub fn get_transactions(env: Env) -> Vec<Map<String, String>> {
        env.storage()
            .persistent()
            .get(&symbol_short!("txs"))
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_transaction_count(env: Env) -> u32 {
        let txs: Vec<Map<String, String>> = env
            .storage()
            .persistent()
            .get(&symbol_short!("txs"))
            .unwrap_or_else(|| Vec::new(&env));
        txs.len()
    }

    fn str_to_i64(_env: &Env, s: &String) -> i64 {
        let len = s.len();
        if len == 0 || len > 20 {
            return 0;
        }

        let mut buffer = [0u8; 20];
        s.copy_into_slice(&mut buffer[..len as usize]);

        let mut i = 0;
        let negative = buffer[0] == b'-';
        if negative {
            i = 1;
        }

        let mut result: i64 = 0;
        while i < len as usize {
            let byte = buffer[i];
            if byte < b'0' || byte > b'9' {
                return 0;
            }
            let digit = (byte - b'0') as i64;
            result = result * 10 + digit;
            i += 1;
        }

        if negative { -result } else { result }
    }

    fn i64_to_str(env: &Env, n: i64) -> String {
        let mut buffer = itoa::Buffer::new();
        let formatted = buffer.format(n);
        String::from_str(env, formatted)
    }
}