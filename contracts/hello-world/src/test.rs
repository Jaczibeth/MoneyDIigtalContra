#![cfg(test)]
mod tests {
    use soroban_sdk::{Env, Address, String, testutils::Address as _};

    use crate::{MoneyDigital, MoneyDigitalClient};

    fn create_env() -> Env {
        let env = Env::default();
        env.mock_all_auths();
        env
    }

    fn addr(env: &Env) -> Address {
        Address::generate(env)
    }

    #[test]
    fn test_initialize() {
        let env = create_env();
        let admin = addr(&env);

        let contract_id = env.register(MoneyDigital, ());
        let client = MoneyDigitalClient::new(&env, &contract_id);
        client.initialize(&admin);

        assert_eq!(client.get_admin(), admin);
    }

    #[test]
    fn test_register_wallet() {
        let env = create_env();
        let admin = addr(&env);

        let contract_id = env.register(MoneyDigital, ());
        let client = MoneyDigitalClient::new(&env, &contract_id);
        client.initialize(&admin);

        let wallet = addr(&env);
        assert!(client.register_wallet(&wallet));
    }

    #[test]
    fn test_get_balance() {
        let env = create_env();
        let admin = addr(&env);

        let contract_id = env.register(MoneyDigital, ());
        let client = MoneyDigitalClient::new(&env, &contract_id);
        client.initialize(&admin);

        let wallet = addr(&env);
        client.register_wallet(&wallet);
        assert_eq!(client.get_balance(&wallet), 0);
    }

    #[test]
    fn test_mint() {
        let env = create_env();
        let admin = addr(&env);

        let contract_id = env.register(MoneyDigital, ());
        let client = MoneyDigitalClient::new(&env, &contract_id);
        client.initialize(&admin);

        let wallet = addr(&env);
        assert!(client.mint(&admin, &wallet, &100));
        assert_eq!(client.get_balance(&wallet), 100);
    }

    #[test]
    fn test_transfer() {
        let env = create_env();
        let admin = addr(&env);

        let contract_id = env.register(MoneyDigital, ());
        let client = MoneyDigitalClient::new(&env, &contract_id);
        client.initialize(&admin);

        let from = addr(&env);
        let to = addr(&env);

        client.register_wallet(&from);
        client.register_wallet(&to);
        client.mint(&admin, &from, &100);

        assert!(client.transfer(&from, &to, &50));
        assert_eq!(client.get_balance(&from), 50);
        assert_eq!(client.get_balance(&to), 50);
    }

    #[test]
    fn test_burn() {
        let env = create_env();
        let admin = addr(&env);

        let contract_id = env.register(MoneyDigital, ());
        let client = MoneyDigitalClient::new(&env, &contract_id);
        client.initialize(&admin);

        let wallet = addr(&env);
        client.mint(&admin, &wallet, &100);

        assert!(client.burn(&admin, &wallet, &30));
        assert_eq!(client.get_balance(&wallet), 70);
    }

    #[test]
    fn test_total_supply() {
        let env = create_env();
        let admin = addr(&env);

        let contract_id = env.register(MoneyDigital, ());
        let client = MoneyDigitalClient::new(&env, &contract_id);
        client.initialize(&admin);

        let wallet_a = addr(&env);
        let wallet_b = addr(&env);

        client.mint(&admin, &wallet_a, &100);
        client.mint(&admin, &wallet_b, &50);

        assert_eq!(client.get_total_supply(), 150);
    }

    #[test]
    fn test_transfer_insufficient_balance() {
        let env = create_env();
        let admin = addr(&env);

        let contract_id = env.register(MoneyDigital, ());
        let client = MoneyDigitalClient::new(&env, &contract_id);
        client.initialize(&admin);

        let from = addr(&env);
        let to = addr(&env);

        client.register_wallet(&from);
        client.register_wallet(&to);
        client.mint(&admin, &from, &10);

        assert!(!client.transfer(&from, &to, &100));
    }

    #[test]
    fn test_mint_unauthorized() {
        let env = create_env();
        let admin = addr(&env);

        let contract_id = env.register(MoneyDigital, ());
        let client = MoneyDigitalClient::new(&env, &contract_id);
        client.initialize(&admin);

        let fake_admin = addr(&env);
        let wallet = addr(&env);

        assert!(!client.mint(&fake_admin, &wallet, &100));
    }

    #[test]
    fn test_store_and_verify_certificate() {
        let env = create_env();
        let admin = addr(&env);

        let contract_id = env.register(MoneyDigital, ());
        let client = MoneyDigitalClient::new(&env, &contract_id);
        client.initialize(&admin);

        let wallet = addr(&env);
        client.register_wallet(&wallet);

        let hash = String::from_str(&env, "abc123def456hash");
        assert!(client.store_certificate_hash(&wallet, &hash));

        assert_eq!(client.get_certificate_count(&wallet), 1);
        assert!(client.verify_certificate_hash(&wallet, &1, &hash));
        assert!(!client.verify_certificate_hash(&wallet, &1, &String::from_str(&env, "fake")));
    }

    #[test]
    fn test_wallet_not_registered_by_default() {
        let env = create_env();
        let admin = addr(&env);

        let contract_id = env.register(MoneyDigital, ());
        let client = MoneyDigitalClient::new(&env, &contract_id);
        client.initialize(&admin);

        let wallet = addr(&env);
        assert!(!client.is_wallet_registered(&wallet));
    }

    #[test]
    fn test_double_register_fails() {
        let env = create_env();
        let admin = addr(&env);

        let contract_id = env.register(MoneyDigital, ());
        let client = MoneyDigitalClient::new(&env, &contract_id);
        client.initialize(&admin);

        let wallet = addr(&env);
        assert!(client.register_wallet(&wallet));
        assert!(!client.register_wallet(&wallet));
    }
}
