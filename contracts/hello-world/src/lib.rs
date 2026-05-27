#![no_std]

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String};

#[cfg(test)]
mod test;

#[contract]
pub struct MoneyDigital;

#[contractimpl]
impl MoneyDigital {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().persistent().has(&symbol_short!("admin")) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().persistent().set(&symbol_short!("admin"), &admin);
        env.storage().persistent().set(&symbol_short!("supply"), &0i128);
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage().persistent().get(&symbol_short!("admin")).unwrap()
    }

    pub fn is_initialized(env: Env) -> bool {
        env.storage().persistent().has(&symbol_short!("admin"))
    }

    pub fn register_wallet(env: Env, wallet: Address) -> bool {
        let key = (symbol_short!("bal"), wallet.clone());
        if env.storage().persistent().has(&key) {
            return false;
        }
        env.storage().persistent().set(&key, &0i128);
        true
    }

    pub fn is_wallet_registered(env: Env, wallet: Address) -> bool {
        let key = (symbol_short!("bal"), wallet);
        env.storage().persistent().has(&key)
    }

    pub fn get_balance(env: Env, wallet: Address) -> i128 {
        let key = (symbol_short!("bal"), wallet);
        env.storage().persistent().get(&key).unwrap_or(0)
    }

    pub fn get_total_supply(env: Env) -> i128 {
        env.storage().persistent().get(&symbol_short!("supply")).unwrap_or(0)
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) -> bool {
        from.require_auth();

        if amount <= 0 {
            return false;
        }

        let from_key = (symbol_short!("bal"), from.clone());
        let to_key = (symbol_short!("bal"), to.clone());

        let from_balance: i128 = env.storage().persistent().get(&from_key).unwrap_or(0);
        if from_balance < amount {
            return false;
        }

        let to_balance: i128 = env.storage().persistent().get(&to_key).unwrap_or(0);

        env.storage().persistent().set(&from_key, &(from_balance - amount));
        env.storage().persistent().set(&to_key, &(to_balance + amount));

        true
    }

    pub fn mint(env: Env, admin: Address, wallet: Address, amount: i128) -> bool {
        admin.require_auth();

        let stored_admin: Address = env.storage().persistent().get(&symbol_short!("admin")).unwrap();
        if admin != stored_admin {
            return false;
        }
        if amount <= 0 {
            return false;
        }

        let key = (symbol_short!("bal"), wallet.clone());
        let balance: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(balance + amount));

        let supply: i128 = env.storage().persistent().get(&symbol_short!("supply")).unwrap();
        env.storage().persistent().set(&symbol_short!("supply"), &(supply + amount));

        true
    }

    pub fn burn(env: Env, admin: Address, wallet: Address, amount: i128) -> bool {
        admin.require_auth();

        let stored_admin: Address = env.storage().persistent().get(&symbol_short!("admin")).unwrap();
        if admin != stored_admin {
            return false;
        }
        if amount <= 0 {
            return false;
        }

        let key = (symbol_short!("bal"), wallet.clone());
        let balance: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if balance < amount {
            return false;
        }

        env.storage().persistent().set(&key, &(balance - amount));

        let supply: i128 = env.storage().persistent().get(&symbol_short!("supply")).unwrap();
        env.storage().persistent().set(&symbol_short!("supply"), &(supply - amount));

        true
    }

    /// Almacena el hash SHA-256 de un certificado en la blockchain
    pub fn store_certificate_hash(env: Env, wallet: Address, cert_hash: String) -> bool {
        if !Self::is_wallet_registered(env.clone(), wallet.clone()) {
            return false;
        }
        let nonce = Self::next_nonce(&env, &wallet);
        let key = (symbol_short!("cert"), wallet, nonce);
        env.storage().persistent().set(&key, &cert_hash);
        true
    }

    /// Verifica que un hash de certificado existe en la blockchain
    pub fn verify_certificate_hash(env: Env, wallet: Address, nonce: u32, cert_hash: String) -> bool {
        let key = (symbol_short!("cert"), wallet, nonce);
        let stored: String = match env.storage().persistent().get(&key) {
            Some(h) => h,
            None => return false,
        };
        stored == cert_hash
    }

    /// Retorna el número de certificados almacenados para una wallet
    pub fn get_certificate_count(env: Env, wallet: Address) -> u32 {
        let key = (symbol_short!("cnnce"), wallet);
        env.storage().persistent().get(&key).unwrap_or(0)
    }

    fn next_nonce(env: &Env, wallet: &Address) -> u32 {
        let key = (symbol_short!("cnnce"), wallet.clone());
        let current: u32 = env.storage().persistent().get(&key).unwrap_or(0);
        let next = current + 1;
        env.storage().persistent().set(&key, &next);
        next
    }
}
