// binance-realtime-full.js
// Full client-side script: original functions + real-time integration

jQuery.fn.getStyleValue = function (prop) {
  return parseFloat($(this).css(prop).replace("px", ""));
};

// ------------------------------------------------------
// CONFIG & GLOBALS
// ------------------------------------------------------

const WORKER_URL = "https://johnathan-denobetterp-43-rehbv5e0phsa.deno.dev";
const PUB_WS = "wss://stream.binance.com:9443/stream";
const USER_WS = "wss://stream.binance.com:9443/ws";

let priceWs = null,
  userWs = null;
const vHeightMax = 208.5 - 30,
  vHeightMin = 48.5 - 30;

// FEEs, UI flags, timeouts, data holders
const takerFEE = 0.0001,
  makerFEE = 0.0001;
const isMobile = /Mobi/.test(navigator.userAgent);
const DRAG_THRESHOLD = 15,
  MAX_PULL = 30;

var isBacking = false,
  backerX = 0,
  backerY = 0;
var current_page = "app",
  current_simulator_mode = "sell";
var walletData = false,
  oldWalletData = false;
var API = false,
  params = false;

var haveWebNotificationsBeenAccepted = false;
var focusedCoin = false,
  coinPrices = false;
var isLogged = false,
  firstLog = true,
  fullyLoaded = false;
var initialDeposit = 0,
  availableFunds = 0;

var positions = {};

walletData = { coins: [], global: { bank: 0, pnl: 0 } };
coinPrices = coinPrices || {};

const stableCoins = {
  USDC: { label: "USDC", short: "$", conversionRate: 1 },
  TRY: { label: "TRY", short: "₺", conversionRate: null },
  EUR: { label: "EUR", short: "€", conversionRate: null },
};

// ------------------------------------------------------
// 1) STORAGE & PARAMS
// ------------------------------------------------------

function api_read() {
  let d = localStorage.getItem("api");
  if (!d) {
    isLogged = false;
    return { API: "noData", SECRET: "noData" };
  }
  isLogged = true;
  return JSON.parse(d);
}
function api_save(data) {
  localStorage.setItem("api", JSON.stringify(data));
}
function api_delete() {
  localStorage.removeItem("api");
}

function old_read() {
  let d = localStorage.getItem("oldWallet");
  if (!d) return false;
  return JSON.parse(d);
}
function old_save(d) {
  localStorage.setItem("oldWallet", JSON.stringify(d));
}

function params_read() {
  let d = localStorage.getItem("params");
  if (!d) {
    params = {
      filter: { var: "NAME", way: "DESC" },
      isPercentage: false,
      onLoadPnlType: "ongoing",
      minified: {},
    };

    $("#sortingVar").val("NAME");
    $("#sortingWay").val("DESC");
    return params;
  }

  params = JSON.parse(d);
  $("#sortingVar").val(params.filter.var);
  $("#sortingWay").val(params.filter.way);

  $(".pnl")
    .find(".global_elem_scrollable")
    .scrollLeft(
      params.onLoadPnlType == "allTime"
        ? $(".pnl").find(".global_elem_scrollable")[0].scrollWidth
        : 0
    );

  $(".parameter_percentage").css(
    "backgroundColor",
    params.isPercentage ? "var(--yellow)" : "var(--light-color)"
  );

  return params;
}
function params_save(d) {
  localStorage.setItem("params", JSON.stringify(d));
}

// ------------------------------------------------------
// 2) UTILITIES
// ------------------------------------------------------

function cloneOBJ(o) {
  return JSON.parse(JSON.stringify(o));
}

function fixNumber(n, fix, expand) {
  n = parseFloat(n);
  if (expand) {
    fix = Math.abs(n) >= expand.limit ? fix : fix + expand.val;
  }
  let f = n.toFixed(fix);
  return Math.abs(Math.floor(f)) == Math.abs(Math.ceil(f)) ? n.toFixed(2) : f;
}
function fixNumberBis(n, fix) {
  n = parseFloat(n);
  if (isNaN(n)) return "NaN";
  const [i, d = ""] = Math.abs(n).toString().split(".");
  const dec = Math.max(0, fix - i.length);
  let r = Math.abs(n).toFixed(dec);
  if (dec > 0) {
    const [, rd = ""] = r.split(".");
    r += "0".repeat(dec - rd.length);
  }
  return n < 0 ? "-" + r : r;
}

function isNacN(input) {
  if (typeof input === "number") input = input.toString();
  return !/^-?\d*\.?\d+$/.test(input);
}

function getObjectKeyIndex(obj, key, val) {
  for (let i = 0; i < obj.length; i++) {
    if (obj[i][key] == val) return i;
  }
  return -1;
}

function showBlurPage(className) {
  $(".blurBG")
    .children(":not(." + className + ")")
    .css("display", "none");
  $("." + className + "").css("display", "flex");
  $(".blurBG").css("display", "flex");
}

function resizeInput(input) {
  let fontSize = $(input).getStyleValue("fontSize");

  if (input.value.length == 0) {
    input.style.width =
      fontSize / 1.615384 - fontSize / 22.702702 + fontSize / 4 + "px";
  } else if (input.value.length >= 3) {
    input.style.width =
      3 * (fontSize / 1.615384 - fontSize / 22.702702) + fontSize / 4 + "px";
  } else {
    input.style.width =
      input.value.length * (fontSize / 1.615384 - fontSize / 22.702702) +
      fontSize / 4 +
      "px";
  }
}

// ------------------------------------------------------
// 3) FETCH + HMAC + WORKER PROXY
// ------------------------------------------------------

async function signHmacSha256(qs, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(qs));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchJSON(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function proxySigned(apiKey, endpoint, queryString) {
  return fetchJSON(`${WORKER_URL}/proxySigned`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, endpoint, queryString }),
  });
}

// ------------------------------------------------------
// 4) PUBLIC & PRIVATE WEBSOCKETS
// ------------------------------------------------------

async function createListenKey(apiKey) {
  return fetchJSON(`${WORKER_URL}/listenKey`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey }),
  }).then((x) => x.listenKey);
}

async function keepAliveKey(apiKey, lk) {
  return fetchJSON(`${WORKER_URL}/listenKey`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, listenKey: lk }),
  });
}

async function connectUserWS(apiKey, handlers) {
  if (userWs) userWs.close();
  const lk = await createListenKey(apiKey);

  try {
    userWs = new WebSocket(`${USER_WS}/${lk}`);
  } catch (error) {
    throw error;
  }

  userWs.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    switch (msg.e) {
      case "outboundAccountPosition":
        handlers.onBalances(msg.B);
        break;
      case "executionReport":
        handlers.onOrderUpdate(msg);
        break;
      case "balanceUpdate":
        handlers.onBalanceUpdate(msg);
        break;
      default:
        console.debug(msg);
    }
  };
  userWs.onerror = console.error;
  userWs.onclose = () => console.warn("User WS closed");
  setInterval(() => keepAliveKey(apiKey, lk), 30 * 60 * 1000);
}

function connectPriceWS(assets, onPrice) {
  if (priceWs) priceWs.close();
  if (!assets.length) return;
  const streams = assets.map((a) => a.toLowerCase() + "usdc@ticker").join("/");

  try {
    priceWs = new WebSocket(`${PUB_WS}?streams=${streams}`);
  } catch (error) {
    throw error;
  }

  priceWs.onmessage = (e) => {
    const { data } = JSON.parse(e.data);
    onPrice(data.s, parseFloat(data.c));
  };
  priceWs.onerror = console.error;
  priceWs.onclose = () => console.warn("Public WS closed");
}

async function getFiatHistoryFirstPage(apiKey, apiSecret, transactionType) {
  //  ——  earliest possible time (Unix epoch)  ——
  const beginTime = 0; // 1970-01-01T00:00:00Z
  const endTime = Date.now(); // “now”
  const rows = 500; // (max)

  // mandatory signed parameters
  const ts = Date.now();
  const qs =
    `transactionType=${transactionType}` +
    `&beginTime=${beginTime}` +
    `&endTime=${endTime}` +
    `&rows=${rows}` +
    `&timestamp=${ts}`;
  const sig = await signHmacSha256(qs, apiSecret);
  const fullQuery = `${qs}&signature=${sig}`;

  // send through the worker’s /proxyFiatOrders endpoint
  try {
    return fetchJSON(`${WORKER_URL}/proxyFiatOrders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, queryString: fullQuery }),
    });
  } catch (error) {
    throw error;
  }
}

async function getFiatPaymentsFirstPage(apiKey, apiSecret, type) {
  const rows = 500;
  const now = Date.now(); // also used as timestamp
  const qs =
    `transactionType=${type}` +
    `&beginTime=0` + // start of history
    `&endTime=${now}` +
    `&rows=${rows}` +
    `&timestamp=${now}`;

  const sig = await signHmacSha256(qs, apiSecret);
  const full = `${qs}&signature=${sig}`;

  // requires the /proxyFiatPayments route already added in the worker
  try {
    return fetchJSON(`${WORKER_URL}/proxyFiatPayments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, queryString: full }),
    });
  } catch (error) {
    throw error;
  }
}

async function getFiatDeposit(apiKey, apiSecret) {
  let deposit, deposit2, withdraw;

  try {
    deposit = await getFiatHistoryFirstPage(apiKey, apiSecret, 0);
    deposit2 = await getFiatPaymentsFirstPage(apiKey, apiSecret, 0);
    withdraw = await getFiatHistoryFirstPage(apiKey, apiSecret, 1);
  } catch (error) {
    throw error;
  }
  let sum_deposit = !Array.isArray(deposit.data)
    ? 0
    : deposit.data.reduce(
        (sum, r) =>
          r.status === "Successful"
            ? sum +
              Math.abs(parseFloat(r.indicatedAmount)) *
                (coinPrices[r.fiatCurrency + "USDC"] ?? 1)
            : sum,
        0
      );

  let sum_deposit2 = !Array.isArray(deposit2.data)
    ? 0
    : deposit2.data.reduce(
        (sum, r) =>
          r.status === "Completed"
            ? sum +
              Math.abs(parseFloat(r.sourceAmount)) *
                (coinPrices[r.fiatCurrency + "USDC"] ?? 1)
            : sum,
        0
      );

  let sum_withdraw = !Array.isArray(withdraw.data)
    ? 0
    : withdraw.data.reduce(
        (sum, r) =>
          r.status === "Successful"
            ? sum +
              Math.abs(parseFloat(r.indicatedAmount)) *
                (coinPrices[r.fiatCurrency + "USDC"] ?? 1)
            : sum,
        0
      );

  return sum_deposit + sum_deposit2 - sum_withdraw;
}

async function getReservedFundsUSDC(apiKey, apiSecret) {
  /* 1 – build & sign the query string */
  const ts = Date.now();
  let qs = `timestamp=${ts}`; // no symbol ⇒ all symbols
  const sig = await signHmacSha256(qs, apiSecret);
  qs += `&signature=${sig}`;

  /* 2 – request open orders through the worker */
  let orders;

  try {
    orders = await fetchJSON(`${WORKER_URL}/proxyOpenOrders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, queryString: qs }),
    });
  } catch (error) {
    throw error;
  }

  if (!Array.isArray(orders) || !orders.length) return 0;

  /* 3 – sum reserved quote value, converting each leg to USDC */
  return orders.reduce((sum, o) => {
    if (o.side !== "BUY" || !["NEW", "PARTIALLY_FILLED"].includes(o.status))
      return sum;

    // remaining quantity still waiting to fill
    const remainingQty = parseFloat(o.origQty) - parseFloat(o.executedQty || 0);

    // unit price (Binance returns it as string); some market orders have price "0"
    const price = parseFloat(o.price || o.cummulativeQuoteQty / o.origQty);

    if (!remainingQty || !price) return sum;

    // detect the quote currency by checking against known stable-coins
    let quote = null;
    for (const sc in stableCoins) {
      if (o.symbol.endsWith(sc)) {
        quote = sc;
        break;
      }
    }
    if (!quote) return sum; // skip exotic pairs

    const quoteToUSDC = coinPrices[quote + "USDC"] ?? 1; // usually 1 for USDC itself
    const reservedUSDC = remainingQty * price * quoteToUSDC;

    return sum + reservedUSDC;
  }, 0);
}

// ------------------------------------------------------
// 5) ORIGINAL DATA-PROCESSING & DISPLAY
// ------------------------------------------------------

function filterWalletData(data) {
  const mode = params["filter"]["var"];
  const way = params["filter"]["way"];

  let wallet = cloneOBJ(data);
  wallet.coins = wallet.coins.filter(
    (coin) => !stableCoins.hasOwnProperty(coin.asset.toUpperCase())
  );

  wallet.coins.sort((a, b) => {
    switch (mode) {
      case "NAME": {
        return a.asset.localeCompare(b.asset);
      }
      case "PNL": {
        const pnlA = parseFloat(a.ongoing_pnl);
        const pnlB = parseFloat(b.ongoing_pnl);

        return pnlA - pnlB;
      }
      case "AMOUNT": {
        const amtA = parseFloat(a.actual_value);
        const amtB = parseFloat(b.actual_value);

        return amtA - amtB;
      }
      default:
        return 0;
    }
  });

  if (way === "DESC") {
    wallet.coins.reverse();
  }

  return wallet;
}

function computeAveragePrice(trades) {
  // Sort by time ascending
  trades.sort((a, b) => a.time - b.time);

  let positionQty = 0.0;
  let positionCost = 0.0;

  for (const t of trades) {
    const qty = parseFloat(t.qty);
    const price = parseFloat(t.price);

    if (t.isBuyer) {
      positionQty += qty;
      positionCost += qty * price;
    } else {
      if (positionQty <= 0) continue;
      const avgCost = positionCost / positionQty;
      const sellQty = qty;
      positionCost -= sellQty * avgCost;
      positionQty -= sellQty;
    }
  }

  if (positionQty > 0) {
    return positionCost / positionQty;
  }

  return null;
}

function filterHoldings(walletData, coinPrices, balances) {
  return balances.filter((b) => {
    const asset = b.asset;
    const quantity = parseFloat(b.free) + parseFloat(b.locked);

    if (coinPrices) {
      if (coinPrices[asset]) {
        let value = quantity * coinPrices[asset];
        return value > 0.5;
      } else {
        return quantity > 0;
      }
    } else {
      if (!stableCoins.hasOwnProperty(asset.toUpperCase())) {
        let coin = walletData.coins.find((c) => c.asset === asset);

        if (coin) {
          let value = quantity * coin.price;
          return value > 0.5;
        } else {
          return quantity > 0;
        }
      } else {
        return true;
      }
    }
  });
}

function displayNewData(walletData) {
  if (API["API"] == "noData" || walletData == false || !fullyLoaded) {
    return;
  }

  updateGlobalElements(walletData, initialDeposit, availableFunds);

  let filteredData = filterWalletData(walletData);

  $(".detail_elem_wrapper")
    .find(".detail_elem")
    .filter((_, el) => {
      const assetName = $(el).find(".detail_elem_name").text();
      return !filteredData.coins.some(
        (coin) => coin.asset === assetName || assetName === "dummy"
      );
    })
    .remove();

  filteredData.coins.forEach(function (coin) {
    if (!stableCoins.hasOwnProperty(coin.asset.toUpperCase())) {
      generateAndPushTile(coin);
    }
  });

  if (fullyLoaded) orderTiles(params["filter"]["var"], params["filter"]["way"]);
}

function updateGlobalElements(walletData, initialDeposit, availableBank) {
  /* ── tiny helpers ────────────────────────────────────────── */
  const fmt = (n, symbol = "$") =>
    `${fixNumber(n, 2, {
      limit: 2,
      val: 2,
    })} <span class="currency">${symbol}</span>`;

  const fmtSigned = (n, symbol) =>
    `${n >= 0 ? "+" : "-"}${fmt(Math.abs(n), symbol)}`;

  const colorFor = (n) =>
    n > 0 ? "var(--green)" : n < 0 ? "var(--red)" : "var(--gray)";

  const ERR = { html: "ERROR", color: "var(--red)" };

  /* ── 1) Total portfolio value (USDC) ─────────────────────── */
  const bankHTML = fmt(walletData.global.bank);

  /* ── 2) Available USDC (wallet - reserved) ──────────────── */
  const avail =
    availableBank === "ERROR"
      ? ERR
      : { html: fmt(availableBank), color: "white" };

  /* ── 3) All-time PnL vs initial deposit ─────────────────── */
  const allPnl =
    initialDeposit === "ERROR"
      ? ERR
      : (() => {
          const delta = params.isPercentage
            ? ((walletData.global.bank - initialDeposit) / initialDeposit) * 100
            : walletData.global.bank - initialDeposit;

          if (isNaN(delta)) return ERR;
          return {
            html: fmtSigned(delta, params.isPercentage ? "%" : "$"),
            color: colorFor(delta),
          };
        })();

  /* ── 4) Ongoing PnL vs cost basis of non-USDC holdings ──── */
  const holdingsCost = Object.entries(positions)
    .filter(([k]) => k !== "USDC")
    .reduce((sum, [_, { qty, cost }]) => sum + qty * cost, 0);

  const ongoing = (() => {
    const raw = params.isPercentage
      ? (walletData.global.pnl / holdingsCost) * 100
      : walletData.global.pnl;

    if (isNaN(raw)) return ERR;
    return {
      html: fmtSigned(raw, params.isPercentage ? "%" : "$"),
      color: colorFor(raw),
    };
  })();

  /* ── 5) Inject values & colours into the DOM ─────────────── */
  $(".bank_data").html(bankHTML);

  $(".available_data").html(avail.html).css("color", avail.color); // ← colour now applied

  $(".all_pnl_data").html(allPnl.html).css("color", allPnl.color);

  $(".ongoingPnl_data").html(ongoing.html).css("color", ongoing.color);
}

function getCoin(coins, name){
  return coins.filter(coin => coin.asset === name);
};

function getCoinProportion(coin) {
  let total_value = 0;

  walletData.coins.forEach((alt_coin) => {
    if (!stableCoins.hasOwnProperty(alt_coin.asset.toUpperCase())) {
      total_value += alt_coin.buy_value;
    }
  });

  return Math.round((coin.buy_value / total_value) * 100);
}

function generateAndPushTile(coin) {
  // Convert the PnL to a number
  const pnlNumber = parseFloat(coin.ongoing_pnl);

  // Determine the sign and color based on the PnL value
  const sign = pnlNumber >= 0 ? "+" : "-";
  const symbol = params.isPercentage ? "%" : "$";
  const formattedPnl = params.isPercentage
    ? fixNumber(Math.abs(pnlNumber / coin.buy_value) * 100, 2)
    : fixNumber(Math.abs(pnlNumber), 2);
  const pnlColor =
    pnlNumber > 0
      ? "var(--green)"
      : pnlNumber < 0
      ? "var(--red)"
      : "var(--gray)";

  const short = stableCoins[coin.quoteCurrency].short;

  const prop = getCoinProportion(coin);
  let isskeleton = fullyLoaded ? "" : "skeleton";

  // Build the HTML using a template literal

  var tileHtml = false;
  let focusedTile = $(".detail_elem_wrapper")
    .find(".detail_elem")
    .filter((_, el) => $(el).find(".detail_elem_name").text() == coin.asset);
  let minified = false;

  if (focusedTile.length == 1) {
    tileHtml = focusedTile.eq(0);
    minified = $(tileHtml).data("minified");

    $(tileHtml).find(".detail_elem_name").text(coin.asset);
    $(tileHtml)
      .find(".detail_elem_amount")
      .text(
        !minified
          ? fixNumberBis(coin.amount, 10) + " | " + prop + "%"
          : prop + "% | "
      );

    $(tileHtml)
      .find(".detail_elem_price")
      .text(fixNumber(coin.price, 2, { limit: 10, val: 2 }) + " " + short);

    $(tileHtml)
      .find(".actual_value")
      .text(fixNumber(coin.actual_value, 2) + " " + "$");
    $(tileHtml)
      .find(".mean_buy")
      .text(fixNumber(coin.mean_buy, 2, { limit: 10, val: 2 }) + " " + short);
    $(tileHtml)
      .find(".buy_value")
      .text(fixNumber(coin.buy_value, 2) + " " + "$");

    $(tileHtml)
      .find(".pnl_data")
      .text(sign + formattedPnl + " " + symbol);
    $(tileHtml).find(".pnl_data").css("color", pnlColor);

    $(tileHtml)
      .find(".detail_elem_header")
      .find(".pnl_data")
      .css("display", minified ? "inline-block" : "none");
  } else {
    tileHtml = $(
      `
      <div class="detail_elem ` +
        isskeleton +
        `">
          <div class="detail_elem_header">
              <span class="detail_elem_title">
                  <span class="detail_elem_name"></span>
                  <span class="detail_elem_amount"></span>
                  <span class="pnl_data"></span>
              </span>
              <span class="detail_elem_price"></span>
          </div>
          <div class="detail_elem_body">
              <div class="detail_subElem">
                  <span class="detail_subElem_title">ACTUAL VALUE</span>
                  <span class="detail_subElem_data actual_value"></span>
              </div>
              <div class="detail_subElem">
                  <span class="detail_subElem_title">MEAN BUY</span>
                  <span class="detail_subElem_data mean_buy"></span>
              </div>
              <div class="detail_subElem">
                  <span class="detail_subElem_title">BUY VALUE</span>
                  <span class="detail_subElem_data buy_value"></span>
              </div>
              <div class="detail_subElem">
                  <span class="detail_subElem_title">ONGOING PNL</span>
                  <span class="detail_subElem_data pnl_data"></span>
              </div>
          </div>
      </div>
      `
    );

    $(tileHtml).data("minified", false);
    // $(tileHtml).data("minified", params.minified[coin.asset]);
    // minifyTile(tileHtml, params.minified[coin.asset] ?? false, false);

    $(tileHtml).find(".detail_elem_name").text(coin.asset);
    $(tileHtml)
      .find(".detail_elem_amount")
      .text(fixNumberBis(coin.amount, 10) + " | " + prop + "%");
    $(tileHtml)
      .find(".detail_elem_price")
      .text(fixNumber(coin.price, 2, { limit: 10, val: 2 }) + " " + short);

    $(tileHtml)
      .find(".actual_value")
      .text(fixNumber(coin.actual_value, 2) + " " + "$");
    $(tileHtml)
      .find(".mean_buy")
      .text(fixNumber(coin.mean_buy, 2, { limit: 10, val: 2 }) + " " + short);
    $(tileHtml)
      .find(".buy_value")
      .text(fixNumber(coin.buy_value, 2) + " " + "$");

    $(tileHtml)
      .find(".pnl_data")
      .text(sign + formattedPnl + " " + symbol);
    $(tileHtml).find(".pnl_data").css("color", pnlColor);
  }

  if (!focusedTile.length == 1) {
    $(".detail_elem_wrapper").append(tileHtml);
  }
}

function disconnect() {
  API = {
    API: "noData",
    SECRET: "noData",
  };

  api_delete();
  params_save(params);
  bottomNotification("deleteUser");

  isLogged = false;
  firstLog = false;
  fullyLoaded = false;

  $("#api_key-val").val("");
  $("#api_secret-val").val("");

  clearData(true);
}

function clearData(disconnect) {
  if (oldWalletData && !disconnect) {
    fetchStyleUpdate(false);
    $(".refresh").text("RETRY");

    walletData = cloneOBJ(oldWalletData);
    displayNewData(walletData);
    fetchStyleUpdate(false);
    removeDummy();
  } else {
    $(".detail_elem_wrapper").children().not(".detail_connect").remove();
    $(".global_elem.bank .elem_data").html(
      "0.00" + ' <span class="currency">$</span>'
    );
    $(".global_elem.pnl .elem_data").html(
      "0.00" + ' <span class="currency">$</span>'
    );
    $(".pnl_data").css("color", "var(--gray)");

    $(".detail_elem_wrapper").css("pointer-events", "all");

    if (disconnect) {
      $(".detail_connect").text("CONNECT TO API");
    } else {
      $(".detail_connect").text("FETCH RETRY");
    }

    $(".detail_connect").css("display", "flex");

    initDOMupdate(false);
  }
}

// GRAPHIC UPDATE

function fetchStyleUpdate(fetching, refresh = false) {
  if (fetching) {
    $(".detail_connect").css("display", "none");
    $(".elem_data").not(".skeleton").addClass("skeleton");

    if (!refresh) {
      $(".detail_elem_wrapper").append(
        $(
          '<div class="detail_elem skeleton"><div class="detail_elem_header"><span class="detail_elem_title"><span class="detail_elem_name">DUMY</span><span class="detail_elem_amount">150.5555252 | 33%</span><span class="pnl_data" style="color: var(--green);">+150.00 $</span></span><span class="detail_elem_price">220.00 $</span></div><div class="detail_elem_body"><div class="detail_subElem"><span class="detail_subElem_title">ACTUAL VALUE</span><span class="detail_subElem_data">1000.00 $</span></div><div class="detail_subElem"><span class="detail_subElem_title">BUY PRICE</span><span class="detail_subElem_data">200.00 $</span></div><div class="detail_subElem"><span class="detail_subElem_title">BUY VALUE</span><span class="detail_subElem_data">1200.00 $</span></div><div class="detail_subElem"><span class="detail_subElem_title">ONGOIN PNL</span><span class="detail_subElem_data pnl_data" style="color: var(--green);">+150 $</span></div></div></div>'
        )
      );
      $(".detail_elem_wrapper").append(
        $(
          '<div class="detail_elem skeleton"><div class="detail_elem_header"><span class="detail_elem_title"><span class="detail_elem_name">DUMY</span><span class="detail_elem_amount">150.5555252 | 33%</span><span class="pnl_data" style="color: var(--green);">+150.00 $</span></span><span class="detail_elem_price">220.00 $</span></div><div class="detail_elem_body"><div class="detail_subElem"><span class="detail_subElem_title">ACTUAL VALUE</span><span class="detail_subElem_data">1000.00 $</span></div><div class="detail_subElem"><span class="detail_subElem_title">BUY PRICE</span><span class="detail_subElem_data">200.00 $</span></div><div class="detail_subElem"><span class="detail_subElem_title">BUY VALUE</span><span class="detail_subElem_data">1200.00 $</span></div><div class="detail_subElem"><span class="detail_subElem_title">ONGOIN PNL</span><span class="detail_subElem_data pnl_data" style="color: var(--green);">+150 $</span></div></div></div>'
        )
      );
      $(".detail_elem_wrapper").append(
        $(
          '<div class="detail_elem skeleton"><div class="detail_elem_header"><span class="detail_elem_title"><span class="detail_elem_name">DUMY</span><span class="detail_elem_amount">150.5555252 | 33%</span><span class="pnl_data" style="color: var(--green);">+150.00 $</span></span><span class="detail_elem_price">220.00 $</span></div><div class="detail_elem_body"><div class="detail_subElem"><span class="detail_subElem_title">ACTUAL VALUE</span><span class="detail_subElem_data">1000.00 $</span></div><div class="detail_subElem"><span class="detail_subElem_title">BUY PRICE</span><span class="detail_subElem_data">200.00 $</span></div><div class="detail_subElem"><span class="detail_subElem_title">BUY VALUE</span><span class="detail_subElem_data">1200.00 $</span></div><div class="detail_subElem"><span class="detail_subElem_title">ONGOIN PNL</span><span class="detail_subElem_data pnl_data" style="color: var(--green);">+150 $</span></div></div></div>'
        )
      );
    }

    $(".refresh_container").css("opacity", ".3");
  } else {
    $(".refresh_container").css("opacity", "1");
    $(".skeleton").removeClass("skeleton");
  }
}

function initDOMupdate(connected) {
  if (connected) {
    $(".elem_data").addClass("skeleton");
    $(".detail_connect").css("display", "none");
    fetchStyleUpdate(true);
  } else {
    fetchStyleUpdate(false);
    $(".detail_connect").css("display", "flex");
    $(".refresh_container").css("opacity", ".3");
  }
}

function orderTiles(mode, way) {
  const sortedCoins = filterWalletData(walletData).coins;

  $(".detail_elem_wrapper")
    .children(".detail_elem")
    .sort((a, b) => {
      const assetA = $(a).find(".detail_elem_name").text();
      const assetB = $(b).find(".detail_elem_name").text();

      const coinA = sortedCoins.find((coin) => coin.asset === assetA);
      const coinB = sortedCoins.find((coin) => coin.asset === assetB);

      if (!coinA || !coinB) return 0;
      let comparison = 0;

      switch (mode) {
        case "NAME":
          comparison = assetA.localeCompare(assetB);
          break;
        case "PNL":
          comparison =
            parseFloat(coinA.ongoing_pnl) - parseFloat(coinB.ongoing_pnl);
          break;
        case "AMOUNT":
          comparison =
            parseFloat(coinA.buy_value) - parseFloat(coinB.buy_value);
          break;
        default:
          comparison = 0;
      }

      return way === "DESC" ? -comparison : comparison;
    })
    .appendTo(".detail_elem_wrapper");
}

function minifyTile(elem, coin, minify, animate) {
  const prop = getCoinProportion(coin);

  if (minify) {
    if (animate) {
      $(elem).animate(
        {
          height: vHeightMin,
        },
        300,
        function () {
          $(elem)
            .find(".detail_elem_body")
            .css({ display: "none", opacity: 0 });

          $(elem)
            .find(".detail_elem_amount")
            .text(
              !minify
                ? fixNumberBis(coin.amount, 10) + " | " + prop + "%"
                : prop + "% | "
            );

          $(elem)
            .find(".detail_elem_header")
            .find(".pnl_data")
            .css("display", minify ? "inline-block" : "none");
        }
      );
    } else {
      $(elem).css({ height: vHeightMin });
      $(elem).find(".detail_elem_body").css({ display: "none", opacity: 0 });
    }
  } else {
    if (animate) {
      $(elem).animate(
        {
          height: vHeightMax,
        },
        300,
        function () {
          $(elem).find(".detail_elem_body").css("display", "grid");
          $(elem).find(".detail_elem_body").animate(
            {
              opacity: 1,
            },
            75
          );

          $(elem)
            .find(".detail_elem_amount")
            .text(
              !minify
                ? fixNumberBis(coin.amount, 10) + " | " + prop + "%"
                : prop + "% | "
            );

          $(elem)
            .find(".detail_elem_header")
            .find(".pnl_data")
            .css("display", minify ? "inline-block" : "none");
        }
      );
    } else {
      $(elem).css({ height: vHeightMax });
      $(elem).find(".detail_elem_body").css({ display: "grid", opacity: 1 });
    }
  }
}

// NAVIGATION

function goBack() {
  if (current_page == "app") {
    return;
  } else if (current_page == "connect") {
    closeBlurPage();
  } else if (current_page == "simulator") {
    closeBlurPage();
  }
}

function openConnect() {
  if (isLogged) {
    $("#api_key-val").val(API["API"]);
    $("#api_secret-val").val(API["SECRET"]);
  } else {
    $("#api_key-val").val("");
    $("#api_secret-val").val("");
  }

  showBlurPage("connect_wrapper");
  current_page = "connect";
}

function closeBlurPage() {
  $(".blurBG").css("display", "none");
  $("#sellPrice, #aimedProfit, #buyQuantity, #buyPrice, #meanBuy").val("");

  simulatorStyleUpdate();
  current_page = "app";
}

// NOTIFICATION

function showNotif({ title, body }) {
  if (!("Notification" in window)) {
    console.warn("Notifications are not supported in this browser.");
    return;
  }

  if (Notification.permission === "default") {
    Notification.requestPermission().then((permission) => {
      if (permission === "granted") {
        sendNotification(title, body);
      } else {
        console.warn("Notification permission denied.");
      }
    });
  } else if (Notification.permission === "granted") {
    sendNotification(title, body);
  } else {
    console.warn("Notifications are disabled.");
  }
}

function sendNotification(title, body) {
  let tag = "simple-notification";

  navigator.serviceWorker.ready
    .then((registration) => {
      registration.getNotifications({ tag }).then((notifications) => {
        notifications.forEach((notification) => notification.close());
      });

      registration.showNotification(title, {
        body,
        tag,
      });
    })
    .catch((err) => {
      console.error("Failed to send notification via Service Worker:", err);
    });

  setTimeout(() => {
    deleteNotif(tag);
  }, 10000);
}

function deleteNotif(tag = "simple-notification") {
  navigator.serviceWorker.ready
    .then((registration) => {
      registration.getNotifications({ tag }).then((notifications) => {
        notifications.forEach((notification) => notification.close());
      });
    })
    .catch((err) => {
      console.error("Failed to send notification via Service Worker:", err);
    });
}

function NotificationGrantMouseDownHandler() {
  Notification.requestPermission().then((result) => {
    haveWebNotificationsBeenAccepted = result === "granted";
  });

  $(document).off("click", NotificationGrantMouseDownHandler);
}

function isApop(walletData, oldWalletData) {
  if (!oldWalletData) return;

  const currentPNL = parseFloat(walletData.global.pnl);
  const oldPNL = parseFloat(oldWalletData.global.pnl); // Ensure oldPNL is a number

  const currentBank = parseFloat(walletData.global.bank);
  const oldBank = parseFloat(oldWalletData.global.bank);

  if (isNacN(currentPNL) || isNacN(oldPNL)) {
    console.error("Invalid PNL values.");
    return;
  }

  const difference = currentPNL - oldPNL;
  const percentageChange = ((currentPNL - oldPNL) / Math.abs(oldPNL)) * 100;

  if (percentageChange >= 4.5) {
    showNotif({
      title: "PUMP DETECTED",
      body:
        "ONGOING PNL +" +
        Math.abs(percentageChange).toFixed(2).toString() +
        "% | +" +
        Math.abs(difference).toFixed(2).toString() +
        "$",
    });
    console.log("PUMP");
  } else if (percentageChange <= -3.5) {
    if (Math.abs(currentBank - oldBank) < 1) return;
    showNotif({
      title: "CRASH DETECTED",
      body:
        "ONGOING PNL -" +
        Math.abs(percentageChange).toFixed(2).toString() +
        "% | -" +
        Math.abs(difference).toFixed(2).toString() +
        "$",
    });
    console.log("CRASH");
  }

  return;
}

// HANDLER FUNCTION

function backerMousedownHandler(e) {
  const clientX =
    e.type === "mousedown" ? e.clientX : e.originalEvent.touches[0].clientX;

  const clientY =
    e.type === "mousedown" ? e.pageY : e.originalEvent.touches[0].clientY;

  backerY = clientY;

  if (clientX < DRAG_THRESHOLD) {
    isBacking = true;

    $("#IOSbackerUI").css({
      transition: "none",
      "-webkit-transition": "none",
    });
  }
}

function backerMousemoveHandler(e) {
  if (!isBacking) return;

  const pointerX =
    e.type === "mousemove" ? e.pageX : e.originalEvent.touches[0].pageX;

  backerX = pointerX;

  const windowH = $(window).innerHeight();

  const upperBound = Math.max(0, backerY - Math.round(windowH * 0.3));
  const lowerBound = Math.min(windowH, backerY + Math.round(windowH * 0.3));

  const highCurveHandleX = Math.min(pointerX, MAX_PULL);
  const highCurveHandleY = backerY;
  const lowCurveHandleX = Math.min(pointerX, MAX_PULL);
  const lowCurveHandleY = backerY;

  const pathData = `M 0 ${upperBound} C ${highCurveHandleX} ${highCurveHandleY} ${lowCurveHandleX} ${lowCurveHandleY} 0 ${lowerBound}`;

  $("#IOSbackerUI").css({
    "clip-path": `path("${pathData}")`,
    "-webkit-clip-path": `path("${pathData}")`,
  });
}

function backerMouseupHandler() {
  if (!isBacking) return;
  isBacking = false;

  $("#IOSbackerUI").css({
    transition: "clip-path 0.3s ease, -webkit-clip-path 0.3s ease",
    "-webkit-transition": "clip-path 0.3s ease, -webkit-clip-path 0.3s ease",
  });

  const windowH = $(window).innerHeight();

  const upperBound = Math.max(0, backerY - Math.round(windowH * 0.4));
  const lowerBound = Math.min(windowH, backerY + Math.round(windowH * 0.4));

  const pathData = `M 0 ${upperBound} C 0 ${backerY} 0 ${backerY} 0 ${lowerBound}`;

  $("#IOSbackerUI").css({
    "clip-path": `path("${pathData}")`,
    "-webkit-clip-path": `path("${pathData}")`,
  });

  if (backerX >= MAX_PULL) {
    const event = new CustomEvent("backed", { bubbles: true });
    $("#IOSbackerUI")[0].dispatchEvent(event);
  }
}

let allminified = false;

function minifyTileHandler(elem){
  let minified = $(elem).data("minified") ?? false;
  let name = $(elem).find(".detail_elem_name").text();
  let coin = getCoin(walletData.coins, name)[0] ?? false;

  if (!minified) {
    // params.minified[name] = true;
    minifyTile(elem, coin, true, true);
  } else {
    // params.minified[name] = false;
    minifyTile(elem, coin, false, true);
  }

  $(elem).data("minified", !minified);
  // params_save(params);
};

// SIMULATOR

function loadSimulatorData(mode) {
  let coin =
    walletData.coins[getObjectKeyIndex(walletData.coins, "asset", focusedCoin)];
  let stableCoin = stableCoins[coin.quoteCurrency];
  let short = stableCoin.short;

  $(".simulator_meanBuy").text(
    fixNumber(coin.mean_buy, 2, { limit: 10, val: 2 }) + short
  );

  if (mode == "buy") {
    $(".simulator_buyQuant").text(
      fixNumber(
        parseFloat(coin.buy_value) * parseFloat(stableCoin.conversionRate),
        2,
        { limit: 10, val: 2 }
      ) + short
    );
  } else if (mode == "sell") {
    $(".simulator_buyQuant").text(
      fixNumber(coin.buy_value, 2, { limit: 10, val: 2 }) + "$"
    );
  }

  $(".currencyPlaceholder").text(short);
  $("#coin_selector").val(focusedCoin);

  let placeholderSellPrice = fixNumber(coin.mean_buy * 1.05, 2, {
    limit: 10,
    val: 2,
  });

  $("#sellPrice").attr("placeholder", placeholderSellPrice);
  $("#aimedProfit").attr(
    "placeholder",
    aimedProfitUpdate(placeholderSellPrice)
  );

  let placeholderMeanBuyPrice = fixNumber(coin.mean_buy * 0.85, 2, {
    limit: 10,
    val: 2,
  });
  let pastQuantity = fixNumber(
    parseFloat(coin.buy_value) * parseFloat(stableCoin.conversionRate),
    2,
    { limit: 10, val: 2 }
  );

  $("#buyQuantity").attr("placeholder", pastQuantity);
  $("#meanBuy").attr("placeholder", placeholderMeanBuyPrice);
  $("#buyPrice").attr(
    "placeholder",
    priceUpdate(placeholderMeanBuyPrice, pastQuantity)
  );
}

function clearSelection(mode) {
  if (mode == "buy") {
    $("#buyQuantity").val("");
    $("#meanBuy").val("");
    $("#buyPrice").val("");
  } else if (mode == "sell") {
    $("#sellPrice").val(sellPriceUpdate($("#aimedProfit").val()));
  }
}

function simulatorStyleUpdate() {
  let sell = parseFloat($("#sellPrice").val());
  let profit = parseFloat($("#aimedProfit").val());

  let quantity = parseFloat($("#buyQuantity").val());
  let buyPrice = parseFloat($("#buyPrice").val());
  let meanBuy = parseFloat($("#meanBuy").val());

  let color =
    profit > 0 ? "var(--green)" : profit < 0 ? "var(--red)" : "var(--gray)";

  if (isNacN(sell)) {
    $("#sellPrice")
      .parent()
      .find(".currencyPlaceholder")
      .css("color", "var(--gray)");
  } else {
    $("#sellPrice").parent().find(".currencyPlaceholder").css("color", "white");
  }

  if (isNacN(quantity)) {
    $("#buyQuantity")
      .parent()
      .find(".currencyPlaceholder")
      .css("color", "var(--gray)");
  } else {
    $("#buyQuantity")
      .parent()
      .find(".currencyPlaceholder")
      .css("color", "white");
  }

  if (isNacN(buyPrice)) {
    $("#buyPrice")
      .parent()
      .find(".currencyPlaceholder")
      .css("color", "var(--gray)");
  } else {
    $("#buyPrice").parent().find(".currencyPlaceholder").css("color", "white");
  }

  if (isNacN(meanBuy)) {
    $("#meanBuy")
      .parent()
      .find(".currencyPlaceholder")
      .css("color", "var(--gray)");
  } else {
    $("#meanBuy").parent().find(".currencyPlaceholder").css("color", "white");
  }

  if ($("#aimedProfit").val() == "-") {
    color = "var(--red)";
  } else if ($("#aimedProfit").val() == "+") {
    color = "var(--green)";
  }

  $("#aimedProfit").parent().find(".dollaSignPlaceholder").css("color", color);
  $("#aimedProfit").css("color", color);
}

// --- SELL --- //

function aimedProfitUpdate(sellPrice) {
  if (isNacN(sellPrice)) {
    return "";
  }

  sellPrice = parseFloat(sellPrice) * (1 - takerFEE);
  let coin =
    walletData.coins[getObjectKeyIndex(walletData.coins, "asset", focusedCoin)];

  let buyPrice = parseFloat(coin.mean_buy);
  let amount = parseFloat(coin.buy_value);
  let conversionRate = stableCoins[coin.quoteCurrency].conversionRate || 1;

  let profit =
    ((sellPrice * conversionRate - buyPrice * conversionRate) /
      (buyPrice * conversionRate)) *
    amount;
  return fixNumber(profit, 2, { limit: 10, val: 2 });
}

function sellPriceUpdate(profit) {
  if (isNacN(profit)) {
    return "";
  }

  profit = parseFloat(profit);
  let coin =
    walletData.coins[getObjectKeyIndex(walletData.coins, "asset", focusedCoin)];

  let buyPrice = parseFloat(coin.mean_buy);
  let amount = parseFloat(coin.amount);
  let conversionRate = stableCoins[coin.quoteCurrency].conversionRate || 1;

  let sellPrice =
    ((amount * buyPrice) / conversionRate + profit) /
    (amount / conversionRate) /
    (1 - takerFEE);
  return fixNumber(sellPrice, 2, { limit: 10, val: 2 });
}

// --- BUY --- //

function findAvailableFunds(quoteCurrency) {
  let coin =
    walletData.coins[
      getObjectKeyIndex(walletData.coins, "asset", quoteCurrency)
    ];
  return coin.amount;
}

function priceUpdate(mean_buy, quantity) {
  if (isNacN(mean_buy) || isNacN(quantity)) {
    return "";
  }

  mean_buy = parseFloat(mean_buy);
  quantity = parseFloat(quantity) * (1 - makerFEE);

  let coin =
    walletData.coins[getObjectKeyIndex(walletData.coins, "asset", focusedCoin)];
  let conversionRate = stableCoins[coin.quoteCurrency].conversionRate || 1;

  let pastQuantity = parseFloat(coin.buy_value) * conversionRate;
  let pastTotalCost = pastQuantity * parseFloat(coin.mean_buy);

  let newPrice =
    (mean_buy * (pastQuantity + quantity) - pastTotalCost) / quantity;
  return fixNumber(newPrice, 2, { limit: 10, val: 2 });
}

function meanBuyUpdate(price, quantity) {
  if (isNacN(price) || isNacN(quantity)) {
    return "";
  }

  price = parseFloat(price);
  quantity = parseFloat(quantity) * (1 - makerFEE);

  let coin =
    walletData.coins[getObjectKeyIndex(walletData.coins, "asset", focusedCoin)];
  let conversionRate = stableCoins[coin.quoteCurrency].conversionRate || 1;

  let pastQuantity = parseFloat(coin.buy_value) * conversionRate;

  let pastAmount = pastQuantity * parseFloat(coin.mean_buy);
  let currentAmount = quantity * price;

  let meanBuy = (pastAmount + currentAmount) / (pastQuantity + quantity);
  return fixNumber(meanBuy, 2, { limit: 10, val: 2 });
}

// ------------------------------------------------------
// INIT REAL-TIME + BACKFILL COST BASIS
// ------------------------------------------------------

async function initRealTime(apiKey, apiSecret, onPrice) {
  // 1) snapshot balances
  const ts = Date.now(),
    qs0 = `timestamp=${ts}`;
  const sig = await signHmacSha256(qs0, apiSecret);
  const tradesQ = `${qs0}&signature=${sig}`;
  const snapshot = await proxySigned(apiKey, "/api/v3/account", tradesQ);

  // 2) initialize quantities
  snapshot.balances.forEach((b) => {
    const qty = parseFloat(b.free) + parseFloat(b.locked);
    if (qty > 0) positions[b.asset] = { qty, cost: 0 };
  });

  // 3) backfill cost basis via myTrades
  await Promise.all(
    Object.keys(positions).map(async (asset) => {
      if (stableCoins[asset]) return;
      for (const stable in stableCoins) {
        const sym = asset + stable;
        try {
          // build signed query
          const ts2 = Date.now();
          let qs2 = `symbol=${sym}&timestamp=${ts2}`;
          const sig2 = await signHmacSha256(qs2, apiSecret);
          qs2 += `&signature=${sig2}`;

          const trades = await proxySigned(apiKey, "/api/v3/myTrades", qs2);
          const avg = computeAveragePrice(trades);
          if (avg !== null) positions[asset].cost = avg;
          break;
        } catch (_) {}
      }
    })
  );

  // 4) initial draw
  recomputePortfolio();

  // 5) start real-time streams

  connectPriceWS(Object.keys(positions), onPrice);
  connectUserWS(apiKey, {
    onBalances: handleAccountPosition,
    onOrderUpdate: handleOrderUpdate,
    onBalanceUpdate: handleBalanceUpdate,
  });
}

// ------------------------------------------------------
// WS EVENT HANDLERS & PORTFOLIO RECOMPUTE
// ------------------------------------------------------

function handleAccountPosition(balances) {
  balances.forEach((b) => {
    const asset = b.a || b.asset;
    const qty = parseFloat(b.f ?? b.free) + parseFloat(b.l ?? b.locked);

    // Exclude stablecoin pairs
    if (asset.endsWith("USDC")) return;

    if (qty > 0) {
      positions[asset] = positions[asset] || { qty: 0, cost: 0 };
      positions[asset].qty = qty;
    } else {
      delete positions[asset];
    }
  });

  recomputePortfolio();
}

function handleBalanceUpdate(upd) {
  const asset = upd.a;
  const qty = parseFloat(upd.B);
  if (qty > 0)
    (positions[asset] = positions[asset] || { qty: 0, cost: 0 }),
      (positions[asset].qty = qty);
  else delete positions[asset];

  recomputePortfolio();
}

function handleOrderUpdate(r) {
  const quote = r.s.replace(/[A-Z]+$/, "");
  const asset = r.s.slice(0, r.s.length - quote.length);

  // Exclude stablecoin pairs
  if (asset.endsWith("USDC")) return;

  const qty = parseFloat(r.l),
    price = parseFloat(r.L);
  const pos = (positions[asset] = positions[asset] || { qty: 0, cost: 0 });

  if (r.S === "BUY") {
    pos.cost = (pos.cost * pos.qty + price * qty) / (pos.qty + qty);
    pos.qty += qty;
  } else {
    pos.qty = Math.max(0, pos.qty - qty);
  }

  recomputePortfolio();
}

function removeDummy() {
  $(".detail_elem_wrapper")
    .children(".detail_elem")
    .filter((_, el) => $(el).find(".detail_elem_name").text() == "dummy")
    .remove();
}

function clearMinify(coins) {
  const coinAssets = new Set(coins.map((coin) => coin.asset));

  for (const key of Object.keys(params.minified)) {
    if (!coinAssets.has(key)) {
      delete params.minified[key];
    }
  }
}

function recomputePortfolio() {
  let coins = [],
    bank = 0,
    pnlSum = 0;

  Object.entries(positions).forEach(([asset, pos]) => {
    if (asset.endsWith("USDC") && asset != "USDC") return;

    if (pos.qty * pos.cost <= 0.5 && !stableCoins.hasOwnProperty(asset)) return;

    if (stableCoins.hasOwnProperty(asset)) {
      const conversionRate = stableCoins[asset].conversionRate || 1;
      const curVal = pos.qty * conversionRate;

      coins.push({
        asset,
        amount: pos.qty,
        price: conversionRate,
        actual_value: curVal,
        buy_value: curVal,
        mean_buy: conversionRate,
        ongoing_pnl: "+0",
        quoteCurrency: "USDC",
      });

      bank += curVal;
    } else {
      const price = coinPrices[asset + "USDC"] || 0;
      const buyVal = pos.qty * pos.cost;
      const curVal = pos.qty * price;
      const pnl = curVal - buyVal;

      coins.push({
        asset,
        amount: pos.qty,
        price,
        actual_value: curVal,
        buy_value: buyVal,
        mean_buy: pos.cost,
        ongoing_pnl: pnl >= 0 ? `+${pnl}` : `${pnl}`,
        quoteCurrency: "USDC",
      });

      bank += curVal;
      pnlSum += pnl;
    }
  });

  walletData = {
    coins,
    global: {
      bank: bank,
      pnl: pnlSum,
    },
  };

  displayNewData(walletData);

  let allValid = true;
  walletData.coins
    .filter((coin) => coin.asset != "USDC")
    .forEach((coin) => {
      if (!coinPrices.hasOwnProperty(coin.asset + "USDC")) {
        allValid = false;
      }
    });

  if (allValid) {
    old_save(walletData);

    if (firstLog) {
      clearMinify(walletData.coins);
      params_save(params);
      firstLog = false;

      (async () => {
        try {
          const [fiatDeposit, reservedFunds] = await Promise.all([
            getFiatDeposit(API.API, API.SECRET),
            getReservedFundsUSDC(API.API, API.SECRET),
          ]);

          initialDeposit = fiatDeposit;
          availableFunds = (positions["USDC"]?.qty ?? 0) - reservedFunds;
        } catch (err) {
          console.error("Initial funding check failed:", err);
          initialDeposit = "ERROR";
          availableFunds = "ERROR";
        } finally {
          updateGlobalElements(walletData, initialDeposit, availableFunds);

          isApop(walletData, oldWalletData);
          $(".detail_elem_wrapper").css("pointer-events", "all");

          fetchStyleUpdate(false);
          removeDummy();

          fullyLoaded = true;
        }
      })(); // immediately-invoked async function
    }
  }
}

// ------------------------------------------------------
// OVERRIDE getDataAndDisplay -> initRealTime
// ------------------------------------------------------

async function getDataAndDisplay(refresh = false) {
  if (!isLogged) return;
  if (refresh) {
    displayNewData(walletData);
    return;
  }
  fetchStyleUpdate(true, false);

  try {
    await initRealTime(API.API, API.SECRET, (asset, price) => {
      coinPrices[asset] = price;
      recomputePortfolio();
    });

    bottomNotification("connected");
  } catch (e) {
    bottomNotification("fetchError");
    clearData(false);
  }
}

// ------------------------------------------------------
// 7) pnl() INIT & EVENT BINDINGS
// ------------------------------------------------------

async function pnl() {
  $(".simulator").append(
    $(
      '<span class="versionNB noselect" style="position: absolute; top: 13px; right: 10px; font-size: 14px; opacity: .5; color: white;">v3.7</span>'
    )
  );

  // NAVIGATION
  $(".blurBG").on("click", function (e) {
    if (!$(e.target).is(this)) {
      return;
    }
    closeBlurPage();
  });

  // CONNECT

  $(document).on("click", ".detail_connect", function () {
    if ($(this).text() == "FETCH RETRY") {
      getDataAndDisplay(false);
    } else {
      openConnect();
    }
  });

  $(".profile_connect").on("click", function () {
    openConnect();
  });

  $(".connectBody_wrapper").on("submit", function (e) {
    e.preventDefault();

    let api = $("#api_key-val").val();
    let secret = $("#api_secret-val").val();

    if (api != "" && secret != "") {
      if (!(api == API["API"] && secret == API["SECRET"])) {
        API["API"] = api;
        API["SECRET"] = secret;

        isLogged = true;
        api_save(API);

        $(".detail_elem_wrapper").css("pointer-events", "none");

        closeBlurPage();
        getDataAndDisplay();
      } else {
        closeBlurPage();
        getDataAndDisplay();
      }
    } else {
      bottomNotification("fillConnect");
    }
  });

  $(".connect_disconnect").on("click", function () {
    if (isLogged) {
      clearData();
      disconnect();
      closeBlurPage();
    } else {
      bottomNotification("notConnected");
    }
  });

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "hidden") {
      if (priceWs) priceWs.close();
      if (userWs) userWs.close();
    } else if (document.visibilityState === "visible") {
      try {
        if (initialDeposit == "ERROR" || availableFunds == "ERROR") {
          $(".all_pnl_data, .available_data").addClass("skeleton");
          firstLog = true;
        }

        await initRealTime(API.API, API.SECRET, (asset, price) => {
          coinPrices[asset] = price;
          recomputePortfolio();
        });
      } catch (e) {
        bottomNotification("fetchError");
        clearData(false);
      }
    }
  });

  // FILTERS & FETCHING

  $(".detail_select").on("change", function () {
    params["filter"]["var"] = $("#sortingVar").val();
    params["filter"]["way"] = $("#sortingWay").val();

    orderTiles(params["filter"]["var"], params["filter"]["way"]);
    params_save(params);
  });

  // SIMULATOR

  $(".simulator").on("click", function () {
    if (isLogged && fullyLoaded) {
      current_page = "simulator";

      $("#coin_selector").children().remove();
      for (const coin of walletData.coins) {
        if (!stableCoins.hasOwnProperty(coin.asset.toUpperCase())) {
          $("#coin_selector").append(
            $('<option value="' + coin.asset + '">' + coin.asset + "</option>")
          );
        }
      }

      focusedCoin = focusedCoin
        ? focusedCoin
        : walletData.coins.find(
            (coin) => !stableCoins.hasOwnProperty(coin.asset)
          )?.asset;
      loadSimulatorData(current_simulator_mode);

      showBlurPage("simulator_wrapper");
    }
  });

  $("#coin_selector").on("change", function () {
    focusedCoin = $(this).val();

    clearSelection(current_simulator_mode);
    loadSimulatorData(current_simulator_mode);
  });

  $(".simulatorSelector_opt").on("click", function () {
    if ($(this).text() == "SELL") {
      $(".simulatorSelectorHighlight").animate({ left: "0" }, 250);

      $(".simulator_forthLine").css("display", "none");
      $(".simulator_thirdLine").css("display", "grid");

      current_simulator_mode = "sell";
    } else {
      $(".simulatorSelectorHighlight").animate({ left: "50%" }, 250);

      $(".simulator_thirdLine").css("display", "none");
      $(".simulator_forthLine").css("display", "grid");

      current_simulator_mode = "buy";
    }

    loadSimulatorData(current_simulator_mode);
  });

  // SELL

  $("#sellPrice").on("input change", function () {
    $("#aimedProfit").val(aimedProfitUpdate($(this).val()));
  });

  $("#aimedProfit").on("input", function () {
    $("#sellPrice").val(sellPriceUpdate($(this).val()));
  });

  // BUY

  $("#buyPrice").on("input change", function () {
    if ($("#buyQuantity").val() == "") {
      return;
    }
    $("#meanBuy").val(meanBuyUpdate($(this).val(), $("#buyQuantity").val()));
  });

  $("#buyQuantity").on("input change", function (e) {
    if ($("#buyPrice").val() == "") {
      return;
    }
    $("#meanBuy").val(meanBuyUpdate($("#buyPrice").val(), $(this).val()));
  });

  $("#meanBuy").on("input", function (e) {
    if ($("#buyQuantity").val() == "") {
      return;
    }
    $("#buyPrice").val(priceUpdate($(this).val(), $("#buyQuantity").val()));
  });

  $("#putMaxInvest").on("click", function () {
    let coin =
      walletData.coins[
        getObjectKeyIndex(walletData.coins, "asset", focusedCoin)
      ];
    let availableCurr = fixNumber(findAvailableFunds(coin.quoteCurrency), 2, {
      limit: 10,
      val: 2,
    });
    let maxSafe = availableFunds == "ERROR" ? availableCurr : availableFunds;

    let funds = fixNumber(maxSafe, 2, { limit: 10, val: 2 });

    $("#buyQuantity").val(funds);
    $("#buyQuantity").change();
  });

  $("#actualPrice").on("click", function () {
    let coin =
      walletData.coins[
        getObjectKeyIndex(walletData.coins, "asset", focusedCoin)
      ];
    let price = fixNumber(coin.price, 2, { limit: 10, val: 2 });

    $("#sellPrice").val(price);
    $("#sellPrice").change();
  });

  $("#zero").on("click", function () {
    $("#aimedProfit").val(0);
    $("#sellPrice").val(sellPriceUpdate(0));

    $("#aimedProfit").change();
  });

  $("#currentPrice").on("click", function () {
    let coin =
      walletData.coins[
        getObjectKeyIndex(walletData.coins, "asset", focusedCoin)
      ];

    $("#buyPrice").val(coin.price);
    $("#buyPrice").change();
  });

  $("#aimedProfit, #sellPrice, #buyPrice, #buyQuantity, #meanBuy").on(
    "input change",
    simulatorStyleUpdate
  );

  // UTILITY

  if (isMobile && false) {
    $("#IOSbackerUI").css("display", "block");

    $(document).on("touchstart", backerMousedownHandler);
    $(document).on("touchmove", backerMousemoveHandler);
    $(document).on("touchend", backerMouseupHandler);

    $("#IOSbackerUI").on("backed", function () {
      goBack();
    });
  } else {
    $("#IOSbackerUI").remove();
  }

  $(document).on("keydown", ".strictlyFloatable", function (e) {
    let allowedKeys = [
      ..."0123456789.,",
      "Backspace",
      "ArrowLeft",
      "ArrowRight",
      "Delete",
      "Tab",
    ];

    if ((e.key === "," || e.key === ".") && !$(this).val().includes(".")) {
      e.preventDefault();
      $(this).val($(this).val() + ".");
    } else if (
      (e.key === "," || e.key === ".") &&
      $(this).val().includes(".")
    ) {
      e.preventDefault();
    }

    if (!allowedKeys.includes(e.key)) {
      e.preventDefault();
    }
  });

  $(document).on("click", NotificationGrantMouseDownHandler);

  $(".connect_element_input").on("click", function () {
    this.setSelectionRange(0, this.value.length);
  });

  $('.minifier').on('click', function(){
    $(this).text(!allminified ? '<>' : '-');
    $(this).css('fontSize', !allminified ? '14px' : '18px');

    $('.detail_elem').each((_, elem) => {
      minifyTileHandler(elem);
    });
    
    allminified = !allminified;
  });

  // GRAPHIC UPDATE

  document.oncontextmenu = function () {
    return false;
  };

  $("img").attr("draggable", false);

  $(".parameter_percentage").on("click", function () {
    if (params.isPercentage) {
      $(this).css("backgroundColor", "var(--light-color)");
    } else {
      $(this).css("backgroundColor", "var(--yellow)");
    }

    params.isPercentage = !params.isPercentage;
    updateGlobalElements(walletData, initialDeposit, availableFunds);
    params_save(params);
  });

  $("#api_secret-val").on("input", function () {
    if ($(this).val() == "") {
      $("#api_secret-val").css("fontSize", "16px");
    } else {
      $("#api_secret-val").css("fontSize", "12px");
    }
  });

  $(document).on("input", ".resizingInp", function () {
    resizeInput(this);
  });

  $(".global_elem_scrollable").on("scroll", function (e) {
    let maxScroll = Math.floor(
      $(this).getStyleValue("width") + $(this).getStyleValue("gap")
    );
    let scroll = Math.floor($(this).scrollLeft());

    if (scroll <= 0) {
      $(this)
        .parent()
        .find(".global_elem_indicator_bar")
        .eq(0)
        .css("backgroundColor", "white");
      $(this)
        .parent()
        .find(".global_elem_indicator_bar")
        .eq(1)
        .css("backgroundColor", "black");
    } else if (scroll >= maxScroll) {
      $(this)
        .parent()
        .find(".global_elem_indicator_bar")
        .eq(1)
        .css("backgroundColor", "white");
      $(this)
        .parent()
        .find(".global_elem_indicator_bar")
        .eq(0)
        .css("backgroundColor", "black");
    }

    if ($(this).parent().is(".pnl") && (scroll <= 0 || scroll >= maxScroll)) {
      params.onLoadPnlType = scroll <= 0 ? "ongoing" : "allTime";
      params_save(params);
    }
  });

  $(document).on("click", ".detail_elem", function(){
    minifyTileHandler(this);
  });

  // INIT

  API = api_read();
  params = params_read();
  oldWalletData = old_read();

  if (isLogged) {
    $("#api_key-val").val(API.API);
    $("#api_secret-val").val(API.SECRET);

    $(".detail_elem_wrapper").css("pointer-events", "none");

    getDataAndDisplay(false);
  } else {
    initDOMupdate(false);
  }
}

$(document).ready(pnl);
