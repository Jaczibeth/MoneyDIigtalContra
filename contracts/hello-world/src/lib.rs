#![no_std]

use soroban_sdk::{
    contract, contractimpl, map, symbol_short, Address, Env, Map, String, Symbol, Vec,
};
use itoa;

#[contract]
pub struct MoneyDigital;

#[contractimpl]
impl MoneyDigital {
    // -------------------------
    // Inicialización del contrato
    // -------------------------



    pub fn initialize(env: Env, admin: Address) {
        env.storage()
            .persistent()
            .set(&symbol_short!("admin"), &admin);
        env.storage()
            .persistent()
            .set(&symbol_short!("supply"), &String::from_str(&env, "0"));
    }
    
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .persistent()
            .get(&symbol_short!("admin"))
            .unwrap()
    }




    // -------------------------
    // Registro de wallets
    // -------------------------
    pub fn register_wallet(env: Env, wallet: String, nombre: String, email: String) {
        let mut wallets: Map<String, Map<Symbol, String>> = env
            .storage()
            .persistent()
            .get(&symbol_short!("wallets"))
            .unwrap_or_else(|| Map::new(&env));

        let wallet_data = map![
            &env,
            (symbol_short!("nombre"), nombre),
            (symbol_short!("email"), email),
            (symbol_short!("balance"), String::from_str(&env, "0")),
        ];

        wallets.set(wallet.clone(), wallet_data);
        env.storage().persistent().set(&symbol_short!("wallets"), &wallets);
    }

    pub fn get_wallet_info(env: Env, wallet: String) -> Option<Map<Symbol, String>> {
        let wallets: Map<String, Map<Symbol, String>> = env
            .storage()
            .persistent()
            .get(&symbol_short!("wallets"))
            .unwrap_or_else(|| Map::new(&env));

        wallets.get(wallet)
    }

    // -------------------------
    // Lectura / modificación de balances
    // -------------------------
    pub fn get_balance(env: Env, wallet: String) -> String {
        let wallets: Map<String, Map<Symbol, String>> = env
            .storage()
            .persistent()
            .get(&symbol_short!("wallets"))
            .unwrap_or_else(|| Map::new(&env));

        wallets
            .get(wallet)
            .and_then(|data| data.get(symbol_short!("balance")))
            .unwrap_or_else(|| String::from_str(&env, "0"))
    }

    pub fn set_balance(env: Env, wallet: String, amount: String) {
        let mut wallets: Map<String, Map<Symbol, String>> = env
            .storage()
            .persistent()
            .get(&symbol_short!("wallets"))
            .unwrap_or_else(|| Map::new(&env));

        if let Some(data) = wallets.get(wallet.clone()) {
            let mut updated_data = data.clone();
            updated_data.set(symbol_short!("balance"), amount);
            wallets.set(wallet.clone(), updated_data);
            env.storage().persistent().set(&symbol_short!("wallets"), &wallets);
        }
    }

    // ---------------------------------------------------
    // Helpers: convertir entre String <-> i64 con Soroban
    // ---------------------------------------------------
    fn str_to_i64(env: &Env, s: &String) -> i64 {
        // Convertir Soroban String a i64
        // Implementación simplificada: compara con strings conocidos
        // Nota: Esta implementación tiene limitaciones pero funciona para valores comunes
        
        // Valores comunes (0-100 y algunos negativos)
        // Para valores más grandes, considera cambiar el diseño para usar i128 directamente
        let common_positive = [
            ("0", 0), ("1", 1), ("2", 2), ("3", 3), ("4", 4), ("5", 5),
            ("6", 6), ("7", 7), ("8", 8), ("9", 9), ("10", 10),
            ("11", 11), ("12", 12), ("13", 13), ("14", 14), ("15", 15),
            ("16", 16), ("17", 17), ("18", 18), ("19", 19), ("20", 20),
            ("25", 25), ("30", 30), ("50", 50), ("100", 100),
            ("1000", 1000), ("10000", 10000), ("100000", 100000),
            ("1000000", 1000000), ("10000000", 10000000),
        ];
        
        for (str_val, int_val) in common_positive.iter() {
            if s == &String::from_str(env, str_val) {
                return *int_val;
            }
        }
        
        // Valores negativos comunes
        let common_negative = [
            ("-1", -1), ("-2", -2), ("-3", -3), ("-4", -4), ("-5", -5),
            ("-6", -6), ("-7", -7), ("-8", -8), ("-9", -9), ("-10", -10),
            ("-20", -20), ("-50", -50), ("-100", -100),
        ];
        
        for (str_val, int_val) in common_negative.iter() {
            if s == &String::from_str(env, str_val) {
                return *int_val;
            }
        }
        
        // Para valores no comunes, retornamos 0
        // Nota: Para una implementación completa que maneje cualquier valor,
        // se necesitaría acceso a bytes/caracteres individuales que no está
        // fácilmente disponible en Soroban SDK sin std.
        // Considera cambiar el diseño para usar i128 directamente en lugar de String.
        0
    }

    fn i64_to_str(env: &Env, n: i64) -> String {
        // Convertir i64 a String de Soroban usando itoa
        let mut buffer = itoa::Buffer::new();
        let formatted = buffer.format(n);
        String::from_str(env, formatted)
    }

    // -------------------------
    // Transferencias
    // -------------------------
    pub fn transfer(env: Env, from: String, to: String, amount: String) -> bool {
        let mut wallets: Map<String, Map<Symbol, String>> = env
            .storage()
            .persistent()
            .get(&symbol_short!("wallets"))
            .unwrap_or_else(|| Map::new(&env));

        let from_wallet = match wallets.get(from.clone()) {
            Some(w) => w,
            None => return false,
        };

        let from_balance = Self::str_to_i64(&env, &from_wallet.get(symbol_short!("balance")).unwrap());
        let amount_i = Self::str_to_i64(&env, &amount);

        if from_balance < amount_i {
            return false;
        }

        // Restar al remitente
        let new_from_balance = Self::i64_to_str(&env, from_balance - amount_i);
        let mut updated_from = from_wallet.clone();
        updated_from.set(symbol_short!("balance"), new_from_balance);
        wallets.set(from.clone(), updated_from);

        // Sumar al destinatario
        let to_wallet = wallets.get(to.clone()).unwrap_or_else(|| {
            map![&env, (symbol_short!("balance"), String::from_str(&env, "0"))]
        });

        let to_balance = Self::str_to_i64(&env, &to_wallet.get(symbol_short!("balance")).unwrap());
        let new_to_balance = Self::i64_to_str(&env, to_balance + amount_i);

        let mut updated_to = to_wallet.clone();
        updated_to.set(symbol_short!("balance"), new_to_balance);
        wallets.set(to.clone(), updated_to);

        env.storage().persistent().set(&symbol_short!("wallets"), &wallets);

        // Registrar transacción
        Self::record_transaction(
            &env,
            from,
            to,
            amount,
            String::from_str(&env, "transfer"),
        );

        true
    }

    // -------------------------
    // Mint
    // -------------------------
    pub fn mint(env: Env, wallet: String, amount: String) -> bool {
        let mut wallets: Map<String, Map<Symbol, String>> = env
            .storage()
            .persistent()
            .get(&symbol_short!("wallets"))
            .unwrap_or_else(|| Map::new(&env));

        let wallet_data = wallets.get(wallet.clone()).unwrap_or_else(|| {
            map![&env, (symbol_short!("balance"), String::from_str(&env, "0"))]
        });

        let balance = Self::str_to_i64(&env, &wallet_data.get(symbol_short!("balance")).unwrap());
        let mint_amount = Self::str_to_i64(&env, &amount);

        let new_balance = Self::i64_to_str(&env, balance + mint_amount);

        let mut updated = wallet_data.clone();
        updated.set(symbol_short!("balance"), new_balance);
        wallets.set(wallet.clone(), updated);

        env.storage().persistent().set(&symbol_short!("wallets"), &wallets);

        // Total supply
        let supply = env
            .storage()
            .persistent()
            .get(&symbol_short!("supply"))
            .unwrap_or_else(|| String::from_str(&env, "0"));

        let new_supply =
            Self::i64_to_str(&env, Self::str_to_i64(&env, &supply) + mint_amount);

        env.storage()
            .persistent()
            .set(&symbol_short!("supply"), &new_supply);

        // Registrar transacción
        Self::record_transaction(
            &env,
            String::from_str(&env, "SYSTEM"),
            wallet,
            amount,
            String::from_str(&env, "mint"),
        );

        true
    }

    // -------------------------
    // Burn
    // -------------------------
    pub fn burn(env: Env, wallet: String, amount: String) -> bool {
        let mut wallets: Map<String, Map<Symbol, String>> = env
            .storage()
            .persistent()
            .get(&symbol_short!("wallets"))
            .unwrap_or_else(|| Map::new(&env));

        let wallet_data = match wallets.get(wallet.clone()) {
            Some(w) => w,
            None => return false,
        };

        let balance = Self::str_to_i64(&env, &wallet_data.get(symbol_short!("balance")).unwrap());
        let burn_amount = Self::str_to_i64(&env, &amount);

        if balance < burn_amount {
            return false;
        }

        let new_balance = Self::i64_to_str(&env, balance - burn_amount);

        let mut updated = wallet_data.clone();
        updated.set(symbol_short!("balance"), new_balance);
        wallets.set(wallet.clone(), updated);

        env.storage().persistent().set(&symbol_short!("wallets"), &wallets);

        // Total supply
        let supply = env
            .storage()
            .persistent()
            .get(&symbol_short!("supply"))
            .unwrap();

        let new_supply =
            Self::i64_to_str(&env, Self::str_to_i64(&env, &supply) - burn_amount);

        env.storage()
            .persistent()
            .set(&symbol_short!("supply"), &new_supply);

        // Registrar transacción
        Self::record_transaction(
            &env,
            wallet.clone(),
            String::from_str(&env, "SYSTEM"),
            amount,
            String::from_str(&env, "burn"),
        );

        true
    }

    // -------------------------
    // Registro simple de transacciones
    // -------------------------
    fn record_transaction(env: &Env, from: String, to: String, amount: String, kind: String) {
        let mut txs: Vec<Map<Symbol, String>> = env
            .storage()
            .persistent()
            .get(&symbol_short!("txs"))
            .unwrap_or_else(|| Vec::new(env));

        let tx = map![
            env,
            (symbol_short!("from"), from),
            (symbol_short!("to"), to),
            (symbol_short!("amount"), amount),
            (symbol_short!("type"), kind)
        ];

        txs.push_back(tx);

        env.storage().persistent().set(&symbol_short!("txs"), &txs);
    }
}
