const audience = "https://oauth-login.cloud.huawei.com/oauth2/v3/token";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64url(input) {
  const bytes = typeof input === "string" ? toBytes(input) : input;
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1] || 0, c = bytes[i + 2] || 0;
    out += alphabet[a >>> 2] + alphabet[((a & 3) << 4) | (b >>> 4)];
    if (i + 1 < bytes.length) out += alphabet[((b & 15) << 2) | (c >>> 6)];
    if (i + 2 < bytes.length) out += alphabet[c & 63];
  }
  return out;
}

function serviceAccount() {
  const source = $os.getenv("STARWARD_PUSH_SERVICE_ACCOUNT_FILE");
  const projectId = $os.getenv("STARWARD_PUSH_PROJECT_ID");
  if (!source || !/^[0-9]{5,32}$/.test(projectId)) throw new Error("Push config incomplete");
  const bytes = $os.readFile(source);
  if (bytes.length > 16384) throw new Error("Push service account invalid");
  // AGC key fields are ASCII. Unrelated JSON fields are never used or logged.
  const config = JSON.parse(String.fromCharCode(...bytes));
  const id = /^[A-Za-z0-9@./:_-]{1,256}$/;
  if (String(config.project_id) !== projectId ||
      typeof config.sub_account !== "string" || !id.test(config.sub_account) ||
      typeof config.key_id !== "string" || !id.test(config.key_id) ||
      typeof config.private_key !== "string" ||
      !/^-----BEGIN (?:RSA )?PRIVATE KEY-----\r?\n/.test(config.private_key))
    throw new Error("Push service account invalid");
  return { ...config, projectId };
}

function signJWT(config) {
  const iat = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({
    alg: "PS256", typ: "JWT", kid: config.key_id,
  }));
  const payload = base64url(JSON.stringify({
    aud: audience, iss: config.sub_account, iat, exp: iat + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  // JSVM cannot sign PS256. Use the system OpenSSL command without a shell;
  // neither the PEM nor any auth token is passed in command arguments.
  const tmp = $filepath.join($os.tempDir(), "starward-push-" + $security.randomString(48));
  $os.mkdir(tmp, 0o700);
  try {
    const key = $filepath.join(tmp, "key.pem"), input = $filepath.join(tmp, "jwt.txt");
    $os.writeFile(key, toBytes(config.private_key), 0o600);
    $os.writeFile(input, toBytes(unsigned), 0o600);
    const signature = $os.cmd("openssl", "dgst", "-sha256", "-sign", key,
      "-sigopt", "rsa_padding_mode:pss", "-sigopt", "rsa_pss_saltlen:-1", input).output();
    return unsigned + "." + base64url(signature);
  } finally {
    $os.removeAll(tmp);
  }
}

function message(job, testMessage, time = Date.now()) {
  const data = {
    starwardPushVersion: "1",
    starwardPushKind: job.kind,
    starwardPushEventId: job.id,
    starwardPushProfileId: job.profileId,
  };
  if (job.kind === "assignment") data.starwardPushTargetId = job.targetId;
  return {
    payload: {
      notification: {
        title: "赴星之约",
        body: "旅途有新消息，打开应用查看。",
        category: "MARKETING",
        foregroundShow: true,
        profileId: job.profileId,
        appMessageId: job.id,
        autoDeletedTime: job.expiresAt,
        clickAction: { actionType: 1, action: "com.sitkin.starward.action.PUSH_OPEN", data },
      },
    },
    target: { token: [job.token] },
    pushOptions: { testMessage, ttl: Math.max(1, Math.ceil((job.expiresAt - time) / 1000)) },
  };
}

function classify(response, token) {
  const code = response.json && /^[0-9]{8}$/.test(response.json.code)
    ? String(response.json.code) : "HTTP" + response.statusCode;
  let invalidToken = false;
  if (token && ["80100000", "80300007"].includes(code) &&
      typeof response.json.msg === "string" && response.json.msg.length <= 16384) {
    try {
      const invalid = JSON.parse(response.json.msg).illegalTokens?.tokenFormatError;
      invalidToken = Array.isArray(invalid) && invalid.includes(token);
    } catch {} // Other Cloud failure reasons don't prove the token is stale.
  }
  return {
    accepted: response.statusCode === 200 && code === "80000000",
    retry: response.statusCode === 429 || response.statusCode >= 500 ||
      ["80200005", "81000001"].includes(code),
    invalidToken, code,
  };
}

function sender(testMessage) {
  const account = serviceAccount();
  const jwt = signJWT(account);
  return (job) => {
    const time = Date.now();
    if (job.expiresAt <= time) return { accepted: false, retry: false, code: "EXPIRED" };
    return classify($http.send({
      method: "POST",
      url: "https://push-api.cloud.huawei.com/v3/" + account.projectId + "/messages:send",
      timeout: 5,
      body: JSON.stringify(message(job, testMessage, time)),
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + jwt,
        "push-type": "0",
      },
    }), job.token);
  };
}

module.exports = { message, sender, classify, signJWT };
