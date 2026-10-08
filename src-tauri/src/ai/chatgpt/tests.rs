//! Tests for chatgpt.rs.

use super::*;

fn jwt(claims: Value) -> String {
    format!(
        "e30.{}.sig",
        oauth::base64url(claims.to_string().as_bytes())
    )
}

#[test]
fn id_token_claims_are_checked() {
    let good = serde_json::json!({
        "iss": "https://auth.openai.com", "aud": ["oaiapp_1"], "exp": 2000,
        "nonce": "n1", "email": "learner@example.com", "sub": "user-1"
    });
    assert_eq!(
        check_id_token(&jwt(good.clone()), "oaiapp_1", "n1", 1000).unwrap(),
        "learner@example.com"
    );
    for (key, value) in [("iss", "https://evil"), ("nonce", "other")] {
        let mut bad = good.clone();
        bad[key] = value.into();
        assert!(
            check_id_token(&jwt(bad), "oaiapp_1", "n1", 1000).is_err(),
            "{key}"
        );
    }
    assert!(
        check_id_token(&jwt(good.clone()), "oaiapp_2", "n1", 1000).is_err(),
        "aud"
    );
    assert!(
        check_id_token(&jwt(good), "oaiapp_1", "n1", 3000).is_err(),
        "exp"
    );
    assert!(check_id_token("garbage", "oaiapp_1", "n1", 1000).is_err());
}

#[test]
fn streamed_text_is_collected_until_completed() {
    let body = "event: response.created\ndata: {\"type\":\"response.created\"}\n\n\
                data: {\"type\":\"response.output_text.delta\",\"delta\":\"今天\"}\n\n\
                data: {\"type\":\"response.output_text.delta\",\"delta\":\"天气好。\"}\n\n\
                data: {\"type\":\"response.completed\",\"response\":{}}\n\n";
    assert_eq!(read_stream(body).unwrap(), "今天天气好。");
}

#[test]
fn plan_limits_and_cut_off_streams_are_explained() {
    let limit = "data: {\"type\":\"response.output_text.delta\",\"delta\":\"x\"}\n\
                 data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"subscription_sharing_usage_limit_exceeded\"}}}\n";
    assert!(read_stream(limit).unwrap_err().contains("额度"));
    let cut = "data: {\"type\":\"response.output_text.delta\",\"delta\":\"x\"}\n";
    assert!(read_stream(cut).unwrap_err().contains("中断"));
}

#[test]
fn model_list_keeps_listed_slugs() {
    let body = r#"{"models":[{"slug":"gpt-6.1-sol","display_name":"GPT-6.1","visibility":"list"},{"slug":"hidden","visibility":"hide"}]}"#;
    assert_eq!(read_models(body).unwrap(), ["gpt-6.1-sol"]);
}

#[tokio::test]
async fn token_requests_are_form_encoded_and_parsed() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/token", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let (mut sock, _) = listener.accept().await.unwrap();
        let mut req = Vec::new();
        let mut buf = vec![0; 4096];
        while !String::from_utf8_lossy(&req).contains("resource=") {
            let n = sock.read(&mut buf).await.unwrap();
            req.extend_from_slice(&buf[..n]);
        }
        let body = r#"{"access_token":"at","refresh_token":"rt2","expires_in":3600,"scope":"openid chatgpt.tokens.use.direct"}"#;
        let res = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{body}",
            body.len()
        );
        sock.write_all(res.as_bytes()).await.unwrap();
        String::from_utf8_lossy(&req).into_owned()
    });
    let t = token_request(
        &[
            ("grant_type", "refresh_token"),
            ("client_id", "oaiapp_1"),
            ("refresh_token", "rt1"),
            ("resource", RESOURCE),
        ],
        &url,
    )
    .await
    .unwrap();
    assert_eq!(
        (
            t.access_token.as_str(),
            t.refresh_token.as_deref(),
            t.expires_in
        ),
        ("at", Some("rt2"), 3600)
    );
    let req = server.await.unwrap();
    assert!(req.contains("application/x-www-form-urlencoded"), "{req}");
    assert!(req.contains("grant_type=refresh_token&client_id=oaiapp_1&refresh_token=rt1&resource=https%3A%2F%2Fapi.openai.com%2Fv1"), "{req}");
}
