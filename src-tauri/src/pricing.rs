use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ModelPricing {
    pub input_per_million: f64,
    pub output_per_million: f64,
    pub cache_write_per_million: f64,
    pub cache_read_per_million: f64,
    pub context_window: i64,       // default (200K for API)
    pub context_window_max: i64,   // with Max plan (1M for opus)
}

pub fn get_pricing(model: &str) -> Option<&'static ModelPricing> {
    static OPUS: ModelPricing = ModelPricing {
        input_per_million: 15.0,
        output_per_million: 75.0,
        cache_write_per_million: 3.75,
        cache_read_per_million: 1.5,
        context_window: 200_000,
        context_window_max: 1_000_000,
    };
    static SONNET: ModelPricing = ModelPricing {
        input_per_million: 3.0,
        output_per_million: 15.0,
        cache_write_per_million: 0.75,
        cache_read_per_million: 0.3,
        context_window: 200_000,
        context_window_max: 200_000,
    };
    static HAIKU: ModelPricing = ModelPricing {
        input_per_million: 0.8,
        output_per_million: 4.0,
        cache_write_per_million: 0.08,
        cache_read_per_million: 0.1,
        context_window: 200_000,
        context_window_max: 200_000,
    };

    // OpenAI models
    static GPT5: ModelPricing = ModelPricing {
        input_per_million: 2.0,
        output_per_million: 8.0,
        cache_write_per_million: 0.0,
        cache_read_per_million: 0.5,
        context_window: 256_000,
        context_window_max: 256_000,
    };
    static O3: ModelPricing = ModelPricing {
        input_per_million: 2.0,
        output_per_million: 8.0,
        cache_write_per_million: 0.0,
        cache_read_per_million: 0.5,
        context_window: 200_000,
        context_window_max: 200_000,
    };
    static GPT4O: ModelPricing = ModelPricing {
        input_per_million: 2.50,
        output_per_million: 10.0,
        cache_write_per_million: 0.0,
        cache_read_per_million: 1.25,
        context_window: 128_000,
        context_window_max: 128_000,
    };
    static O4_MINI: ModelPricing = ModelPricing {
        input_per_million: 1.10,
        output_per_million: 4.40,
        cache_write_per_million: 0.0,
        cache_read_per_million: 0.275,
        context_window: 200_000,
        context_window_max: 200_000,
    };

    // Claude models
    if model.starts_with("claude-opus-4") {
        Some(&OPUS)
    } else if model.starts_with("claude-sonnet-4") {
        Some(&SONNET)
    } else if model.starts_with("claude-haiku-4") {
        Some(&HAIKU)
    // OpenAI models
    } else if model.starts_with("gpt-5") {
        Some(&GPT5)
    } else if model.starts_with("o3") {
        Some(&O3)
    } else if model.starts_with("gpt-4o") {
        Some(&GPT4O)
    } else if model.starts_with("o4-mini") {
        Some(&O4_MINI)
    } else {
        None
    }
}

pub fn get_context_window(model: &str, plan: &str) -> i64 {
    match get_pricing(model) {
        Some(p) => {
            if plan == "max" {
                p.context_window_max
            } else {
                p.context_window
            }
        }
        None => 200_000,
    }
}

pub fn calculate_cost(
    input_tokens: i64,
    output_tokens: i64,
    cache_write_tokens: i64,
    cache_read_tokens: i64,
    model: &str,
) -> f64 {
    let pricing = match get_pricing(model) {
        Some(p) => p,
        None => return 0.0,
    };

    let input = (input_tokens as f64 / 1_000_000.0) * pricing.input_per_million;
    let output = (output_tokens as f64 / 1_000_000.0) * pricing.output_per_million;
    let cache_write = (cache_write_tokens as f64 / 1_000_000.0) * pricing.cache_write_per_million;
    let cache_read = (cache_read_tokens as f64 / 1_000_000.0) * pricing.cache_read_per_million;

    input + output + cache_write + cache_read
}
