#![cfg(test)]
mod tests {
    use soroban_sdk::{Env, String, Address, testutils::Address as _};

    use crate::{MoneyDigital, MoneyDigitalClient};

    fn create_env() -> Env {
        let env = Env::default();
        env.mock_all_auths();
        env
    }

    fn str(env: &Env, s: &str) -> String {
        String::from_str(env, s)
    }

    #[test]
    fn test_initialize() {
        let env = create_env();
        let admin_addr = Address::generate(&env);
        
        let contract_id = env.register(MoneyDigital, ());
        let client = MoneyDigitalClient::new(&env, &contract_id);
        client.initialize(&admin_addr);
        
        let stored_admin = client.get_admin();
        assert_eq!(stored_admin, admin_addr);
    }

    #[test]
    fn test_register_wallet() {
        let env = create_env();
        let admin_addr = Address::generate(&env);
        
        let contract_id = env.register(MoneyDigital, ());
        let client = MoneyDigitalClient::new(&env, &contract_id);
        client.initialize(&admin_addr);

        let wallet = Address::generate(&env);
        let result = client.register_wallet(&wallet.to_string(), &str(&env, "Test"), &str(&env, "test@test.com"));
        assert!(result);
    }

    #[test]
    fn test_get_balance() {
        let env = create_env();
        let admin_addr = Address::generate(&env);
        
        let contract_id = env.register(MoneyDigital, ());
        let client = MoneyDigitalClient::new(&env, &contract_id);
        client.initialize(&admin_addr);

        let wallet = Address::generate(&env);
        let balance = client.get_balance(&wallet.to_string());
        assert_eq!(balance, str(&env, "0"));
    }

    #[test]
    fn test_mint() {
        let env = create_env();
        let admin_addr = Address::generate(&env);
        
        let contract_id = env.register(MoneyDigital, ());
        let client = MoneyDigitalClient::new(&env, &contract_id);
        client.initialize(&admin_addr);

        let wallet = Address::generate(&env);
        let result = client.mint(&admin_addr, &wallet.to_string(), &str(&env, "100"));
        assert!(result);
        
        let balance = client.get_balance(&wallet.to_string());
        assert_eq!(balance, str(&env, "100"));
    }

    #[test]
    fn test_transfer() {
        let env = create_env();
        let admin_addr = Address::generate(&env);
        
        let contract_id = env.register(MoneyDigital, ());
        let client = MoneyDigitalClient::new(&env, &contract_id);
        client.initialize(&admin_addr);

        let wallet_a = Address::generate(&env);
        let wallet_b = Address::generate(&env);
        
        client.register_wallet(&wallet_a.to_string(), &str(&env, "A"), &str(&env, "a@test.com"));
        client.register_wallet(&wallet_b.to_string(), &str(&env, "B"), &str(&env, "b@test.com"));
        client.mint(&admin_addr, &wallet_a.to_string(), &str(&env, "100"));

        let result = client.transfer(&wallet_a.to_string(), &wallet_b.to_string(), &str(&env, "50"));
        assert!(result);
        
        let balance_a = client.get_balance(&wallet_a.to_string());
        let balance_b = client.get_balance(&wallet_b.to_string());
        assert_eq!(balance_a, str(&env, "50"));
        assert_eq!(balance_b, str(&env, "50"));
    }

    #[test]
    fn test_burn() {
        let env = create_env();
        let admin_addr = Address::generate(&env);
        
        let contract_id = env.register(MoneyDigital, ());
        let client = MoneyDigitalClient::new(&env, &contract_id);
        client.initialize(&admin_addr);

        let wallet = Address::generate(&env);
        client.mint(&admin_addr, &wallet.to_string(), &str(&env, "100"));

        let result = client.burn(&admin_addr, &wallet.to_string(), &str(&env, "30"));
        assert!(result);
        
        let balance = client.get_balance(&wallet.to_string());
        assert_eq!(balance, str(&env, "70"));
    }

    #[test]
    fn test_total_supply() {
        let env = create_env();
        let admin_addr = Address::generate(&env);
        
        let contract_id = env.register(MoneyDigital, ());
        let client = MoneyDigitalClient::new(&env, &contract_id);
        client.initialize(&admin_addr);

        let wallet_a = Address::generate(&env);
        let wallet_b = Address::generate(&env);
        client.mint(&admin_addr, &wallet_a.to_string(), &str(&env, "100"));
        client.mint(&admin_addr, &wallet_b.to_string(), &str(&env, "50"));

        let supply = client.get_total_supply();
        assert_eq!(supply, str(&env, "150"));
    }

    #[test]
    fn test_transfer_insufficient_balance() {
        let env = create_env();
        let admin_addr = Address::generate(&env);
        
        let contract_id = env.register(MoneyDigital, ());
        let client = MoneyDigitalClient::new(&env, &contract_id);
        client.initialize(&admin_addr);

        let wallet_a = Address::generate(&env);
        let wallet_b = Address::generate(&env);
        
        client.register_wallet(&wallet_a.to_string(), &str(&env, "A"), &str(&env, "a@test.com"));
        client.register_wallet(&wallet_b.to_string(), &str(&env, "B"), &str(&env, "b@test.com"));
        client.mint(&admin_addr, &wallet_a.to_string(), &str(&env, "10"));

        let result = client.transfer(&wallet_a.to_string(), &wallet_b.to_string(), &str(&env, "100"));
        assert!(!result);
    }

    #[test]
    fn test_mint_unauthorized() {
        let env = create_env();
        let admin_addr = Address::generate(&env);
        
        let contract_id = env.register(MoneyDigital, ());
        let client = MoneyDigitalClient::new(&env, &contract_id);
        client.initialize(&admin_addr);

        let fake_admin = Address::generate(&env);
        let wallet = Address::generate(&env);
        
        let result = client.mint(&fake_admin, &wallet.to_string(), &str(&env, "100"));
        assert!(!result);
    }
}