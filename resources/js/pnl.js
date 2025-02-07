// GLOBAL VARS

const isMobile = /Mobi/.test(navigator.userAgent);

const DRAG_THRESHOLD = 15;
const MAX_PULL = 30;

let isBacking = false;
var backerY = 0;
var backerX = 0;

var current_page = "app";
var walletData = false;
var oldWalletData = false;

var API = false;
var params = false;
var isFetching = false;
var isLogged = false;
var firstLog = true;

var refreshTimeout = null;
var longClickTS = false;
var haveWebNotificationsBeenAccepted = false;

// UTILITY

function isObfuscated(str){
  return str.length > 0 && /^[*]+$/.test(str);
};

function startTimeout(time){
  refreshTimeout = setTimeout(() => {
    if(!isFetching && isLogged){refreshData()};
  }, time * 1000);
};

function stopTimeout(){
  clearTimeout(refreshTimeout);
  refreshTimeout = null;
};

function cloneOBJ(obj){
  return JSON.parse(JSON.stringify(obj));
}

// STORED DATA

function api_read(){
  let data = localStorage.getItem("api");

  if(data === null || data == ""){
      isLogged = false;
      
      return {
          "API": "noData",
          "SECRET": "noData"
      };
  }else{ 
      data = JSON.parse(data);
      isLogged = true;

      return data;
  };
};

function api_save(data){
  localStorage.setItem("api", JSON.stringify(data));
  return;
};

function api_delete(){
localStorage.removeItem("api");
};

function params_read(){
let data = localStorage.getItem("params");

if(data === null || data == ""){
  $("#sortingVar").val("Name");
  $("#sortingWay").val("Asc");

  return {
      "autoRefresh": false,
      "refreshTime": 120,
      "filter": {
        "var": "Name",
        "way": "Asc"
      }
  };
}else{ 
  data = JSON.parse(data);

  $("#sortingVar").val(data['filter']['var']);
  $("#sortingWay").val(data['filter']['way']);
};

return data;
}

function params_save(data){
localStorage.setItem("params", JSON.stringify(data));
return;
};

// DATA FETCH 

async function signHmacSha256(queryString, secret){
  // Using SubtleCrypto
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(queryString);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
  const signatureBytes = new Uint8Array(signatureBuffer);
  const signatureHex = Array.from(signatureBytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
  return signatureHex;
}

async function callBinanceProxy(apiKey, endpoint, queryString){
  const payload = {
    apiKey: apiKey,
    endpoint: endpoint,
    queryString: queryString
  };

  const response = await fetch("https://betterpnl-api.onrender.com/proxySigned", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    bottomNotification('fetchError', response.status);
    clearData(false);
    throw new Error("Proxy error: " + response.status);
  }else if(firstLog && isLogged){
    firstLog = false;
    bottomNotification("connected");
  };

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error);
  }
  return data;
}

async function getAccountInfo(apiKey, apiSecret){
  const timestamp = Date.now();

  let queryString = `timestamp=${timestamp}`;
  const signature = await signHmacSha256(queryString, apiSecret);
  queryString += `&signature=${signature}`;

  return callBinanceProxy(apiKey, "/api/v3/account", queryString);
}

async function getMyTrades(apiKey, apiSecret, symbol){
  const timestamp = Date.now();
  let queryString = `symbol=${symbol}&timestamp=${timestamp}`;
  const signature = await signHmacSha256(queryString, apiSecret);
  queryString += `&signature=${signature}`;
  return callBinanceProxy(apiKey, "/api/v3/myTrades", queryString);
}

async function getSymbolPrice(symbol){
  // Let's try direct fetch (public endpoint).
  // If CORS blocks it, do the same "proxy" approach
  const url = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Error fetching ticker for ${symbol}: ${resp.status}`);
  }
  return resp.json();
}

async function getUserData(){
  isFetching = true

  let walletData = await fetchAndComputePortfolio(API['API'], API['SECRET']);
  if(haveWebNotificationsBeenAccepted && oldWalletData){isApop(walletData, oldWalletData)};

  isFetching = false;

  return walletData;
};

// DATA PROCESSING

function computeAveragePrice(trades){
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

async function fetchAndComputePortfolio(apiKey, apiSecret){
  const result = {
    global: { bank: 0, pnl: 0 },
    coins: []
  };

  // 7.1 Get account info (which is now an array of balances)
  const accountArray = await getAccountInfo(apiKey, apiSecret);
  let totalBalanceCurrent = 0;
  let totalPnl = 0;

  // Loop through each balance entry
  for (const balance of accountArray.balances) {
    const asset = balance.asset;
    const free = parseFloat(balance.free);
    const locked = parseFloat(balance.locked);
    const quantity = free + locked;

    // Skip if zero total
    if (quantity <= 0) continue;

    // Special case: USDC
    if (asset.toUpperCase() === "USDC") {
      // skip if < 1
      if (quantity < 1) {
        continue;
      }
      // Value of USDC is exactly the quantity
      const currentValue = quantity;
      const purchaseValue = currentValue;
      const pnl = 0;
      totalBalanceCurrent += currentValue;
      totalPnl += pnl;

      result.coins.push({
        asset: "USDC",
        amount: quantity.toString(),
        price: "1.00",
        actual_value: currentValue.toFixed(2),
        buy_value: purchaseValue.toFixed(2),
        mean_buy: "1.00",
        ongoing_pnl: pnl.toFixed(2)
      });
      continue;
    }

    // For other assets, we get trades + ticker
    const symbol = asset + "USDC";

    // 7.2 Get trades for that symbol (array)
    let trades = [];
    try {
      trades = await getMyTrades(apiKey, apiSecret, symbol);
    } catch (e) {
      // If there's an error (e.g., no trades, invalid symbol) => skip
      continue;
    }

    // 7.3 Compute average price from trades
    const avgPrice = computeAveragePrice(trades);

    // 7.4 get current price (public endpoint)
    let currentPrice = null;
    let currentValue = 0;

    try {
      const tickerData = await getSymbolPrice(symbol); // e.g. { symbol: "SOLUSDC", price: "231.40" }
      currentPrice = parseFloat(tickerData.price);
      currentValue = quantity * currentPrice;
    } catch (e) {
      // Ticker not found => skip or treat as 0
      currentPrice = null;
    }

    // 7.5 Compute purchaseValue & PnL
    let purchaseValue = 0;
    let pnl = 0;

    if (avgPrice !== null) {
      purchaseValue = quantity * avgPrice;
      pnl = currentValue - purchaseValue;
    } else {
      // If no average cost, assume purchase = current
      purchaseValue = currentValue;
      pnl = 0;
    }

    // skip if < 1 USDC in value
    if (currentValue < 1 && purchaseValue < 1) {
      continue;
    }

    // Tally up totals
    totalBalanceCurrent += currentValue;
    totalPnl += pnl;

    // Add to the final "coins" array
    result.coins.push({
      asset: asset,
      amount: quantity.toString(),
      price: currentPrice ? currentPrice.toFixed(2) : "N/A",
      actual_value: currentValue.toFixed(2),
      buy_value: purchaseValue.toFixed(2),
      mean_buy: avgPrice ? avgPrice.toFixed(2) : "N/A",
      ongoing_pnl: pnl >= 0 ? `+${pnl.toFixed(2)}` : pnl.toFixed(2)
    });
  }

  // 7.6 Final global stats
  result.global.bank = totalBalanceCurrent.toFixed(2);
  result.global.pnl = totalPnl >= 0 ? `+${totalPnl.toFixed(2)}` : totalPnl.toFixed(2);

  return result;
}

// GENERATE n DISPLAY

function fetchStyleUpdate(fetching, refresh=false){
  if(fetching){
    $('.detail_connect').remove();
    $('.detail_subElem_data:not(.mean_buy, .buy_value), .detail_elem_price, .elem_data').text('');
    $('.detail_subElem_data:not(.mean_buy, .buy_value), .detail_elem_price, .elem_data').addClass('skeleton');

    if(!refresh){
      $('.detail_elem_wrapper').append($('<div class="detail_elem skeleton"><div class="detail_elem_header"><span class="detail_elem_title"><span class="detail_elem_amount"></span></span><span class="detail_elem_price"></span></div><div class="detail_elem_body"><div class="detail_subElem"><span class="detail_subElem_title"></span><span class="detail_subElem_data"></span></div><div class="detail_subElem"><span class="detail_subElem_title"></span><span class="detail_subElem_data"></span></div><div class="detail_subElem"><span class="detail_subElem_title"></span><span class="detail_subElem_data"></span></div><div class="detail_subElem"><span class="detail_subElem_title"></span><span class="detail_subElem_data pnl_data" style="color: var(--green);"></span></div></div></div><div class="detail_elem skeleton"><div class="detail_elem_header"><span class="detail_elem_title"><span class="detail_elem_amount"></span></span><span class="detail_elem_price"></span></div><div class="detail_elem_body"><div class="detail_subElem"><span class="detail_subElem_title"></span><span class="detail_subElem_data"></span></div><div class="detail_subElem"><span class="detail_subElem_title"></span><span class="detail_subElem_data"></span></div><div class="detail_subElem"><span class="detail_subElem_title"></span><span class="detail_subElem_data"></span></div><div class="detail_subElem"><span class="detail_subElem_title"></span><span class="detail_subElem_data pnl_data" style="color: var(--green);"></span></div></div></div>'))
    };

    $('.refresh').css('opacity', '.3');
  }else{
    $('.refresh').css('opacity', '1');
    $('.skeleton').removeClass('skeleton');
  }
};

function updateGlobalElements(bank, pnl){
    const pnlColor = pnl > 0 ? 'var(--green)' : pnl < 0 ? 'var(--red)' : 'var(--gray)';
    $('.global_elem.bank .elem_data').html(bank + ' <span class="currency">$</span>');
    $('.global_elem.pnl .elem_data').html(pnl + ' <span class="currency">$</span>');

    $('.pnl_data').css('color', pnlColor)
};

function generateAndPushTile(asset, amount, price, actual_value, buy_value, mean_buy, ongoing_pnl) {
    // Convert the PnL to a number
    const pnlNumber = parseFloat(ongoing_pnl);

    // Determine the sign and color based on the PnL value
    const sign = pnlNumber >= 0 ? '+' : '-';
    const formattedPnl = sign + Math.abs(pnlNumber);
    const pnlColor = pnlNumber > 0 ? 'var(--green)' : pnlNumber < 0 ? 'var(--red)' : 'var(--gray)';

    // Build the HTML using a template literal
    const tileHtml = `
        <div class="detail_elem">
            <div class="detail_elem_header">
                <span class="detail_elem_title">
                    ${asset}
                    <span class="detail_elem_amount">${amount}</span>
                </span>
                <span class="detail_elem_price">${price} $</span>
            </div>
            <div class="detail_elem_body">
                <div class="detail_subElem">
                    <span class="detail_subElem_title">ACTUAL VALUE</span>
                    <span class="detail_subElem_data actual_value">${actual_value} $</span>
                </div>
                <div class="detail_subElem">
                    <span class="detail_subElem_title">MEAN BUY</span>
                    <span class="detail_subElem_data mean_buy">${mean_buy} $</span>
                </div>
                <div class="detail_subElem">
                    <span class="detail_subElem_title">BUY VALUE</span>
                    <span class="detail_subElem_data buy_value">${buy_value} $</span>
                </div>
                <div class="detail_subElem">
                    <span class="detail_subElem_title">ONGOIN PNL</span>
                    <span class="detail_subElem_data pnl_data" style="color: ${pnlColor};">${formattedPnl} $</span>
                </div>
            </div>
        </div>
    `;

    // Append the generated tile to the container with class ".detail_elem_wrapper"
    $('.detail_elem_wrapper').append(tileHtml);
};

function filterWalletData(data){
  const mode = params['filter']['var'];  // "Name" | "PNL" | "Amount" (example)
  const way = params['filter']['way'];   // "ASC" | "DESC"
  
  data.coins.sort((a, b) => {
    switch (mode) {
      case "Name": {
        // Sort by asset name (string comparison)
        return a.asset.localeCompare(b.asset);
      }
      case "PNL": {
        // ongoing_pnl might be "+10" or "10" or "-50", so parseFloat is safe
        const pnlA = parseFloat(a.ongoing_pnl);
        const pnlB = parseFloat(b.ongoing_pnl);
        return pnlA - pnlB;
      }
      case "Amount": {
        const amtA = parseFloat(a.amount);
        const amtB = parseFloat(b.amount);
        return amtA - amtB;
      }
      default:
        return 0;
    }
  });

  // If the user wants descending order, just reverse
  if (way === "Desc") {
    data.coins.reverse();
  }

  return data; 
};

function displayNewData(walletData){
  $('.detail_elem_wrapper').children().remove();

  if(API['API'] == "noData" || walletData == false){return};

  updateGlobalElements(walletData.global.bank, walletData.global.pnl);
  filterWalletData(walletData).coins.forEach(function(coin) {
    if(coin.asset != 'USDC'){
      generateAndPushTile(coin.asset, coin.amount, coin.price, coin.actual_value, coin.buy_value, coin.mean_buy, coin.ongoing_pnl);
    };
  });
};

async function getDataAndDisplay(refresh=false) {
  if(isLogged){
    fetchStyleUpdate(true, refresh);

    walletData = await getUserData();
    oldWalletData = cloneOBJ(walletData);

    if(params['autoRefresh']){startTimeout(params['refreshTime'])};

    if(isLogged){
      displayNewData(walletData);
      fetchStyleUpdate(false);
    };
  };
};

async function refreshData(filter=false){
  if(filter){
      displayNewData(walletData)
  }else{
      stopTimeout();
      getDataAndDisplay(true);
  };

};

function initDOMupdate(connected){
  if(params['autoRefresh']){
    $('.autoRefreshing').css({
      'backgroundColor': 'var(--yellow)',
      'color': 'black'
    });
  }else{
    $('.autoRefreshing').css({
      'backgroundColor': 'var(--light-color)',
      'color': 'white'
    });
  };

  if(connected){
    $('.elem_data').addClass('skeleton');
    $('.detail_connect').remove();
    fetchStyleUpdate(true);
  }else{
    fetchStyleUpdate(false);
    $('.detail_elem_wrapper').append('<div class="detail_connect">CONNECT TO API</div>');
    $('.refresh').css('opacity', '.3');
  };
};

function clearData(disconnect=true){
  $('.detail_elem_wrapper').children().remove();
  $('.global_elem.bank .elem_data').html('0.0' + ' <span class="currency">$</span>');
  $('.global_elem.pnl .elem_data').html('0.0' + ' <span class="currency">$</span>');
  $('.pnl_data').css('color', 'var(--gray)');

  if(disconnect){
    $('#api_key-val').val("");
    $('#api_secret-val').val("");

    API = {
      "API": "noData",
      "SECRET": "noData"
    };
    
    bottomNotification("deleteUser");
    api_delete();
    isLogged = false;

    $('.detail_connect').text("CONNECT TO API");
  }else{
    $('.detail_connect').text("RETRY");
  };


  initDOMupdate(false);
};

// NAVIGATION

function goBack(){
    if(current_page == "app"){
        return
    }else if(current_page == "connect"){
        closeConnect();
    };
};

function openConnect(){
  if(isLogged){
    $('#api_key-val').val("*******************************");
    $('#api_secret-val').val("*******************************");
  }else{
    $('#api_key-val').val("");
    $('#api_secret-val').val("");
  };

  $('.blurBG').css('display', 'flex');
  current_page = 'connect'
};

function closeConnect(){
  $('.blurBG').css('display', 'none');
  current_page = 'app'
};

// NOTIFICATION 

function showNotif({ title, body }){
  if(!('Notification' in window)){
      console.warn('Notifications are not supported in this browser.');
      return;
  }

  if(Notification.permission === 'default'){
      Notification.requestPermission().then(permission => {
          if (permission === 'granted') {
              sendNotification(title, body);
          } else {
              console.warn('Notification permission denied.');
          };
      });
  }else if(Notification.permission === 'granted'){
      sendNotification(title, body);
  }else{
      console.warn('Notifications are disabled.');
  };
};

function sendNotification(title, body){
  let tag = 'simple-notification';

  navigator.serviceWorker.ready.then(registration => {
      registration.getNotifications({ tag }).then(notifications => {
          notifications.forEach(notification => notification.close());
      });

      registration.showNotification(title,{
          body,
          tag
      });
  }).catch(err => {
      console.error('Failed to send notification via Service Worker:', err);
  });

  setTimeout(() => {
    deleteNotif(tag)
  }, 5000);
};

function deleteNotif(tag = 'simple-notification'){
  navigator.serviceWorker.ready.then(registration => {
      registration.getNotifications({ tag }).then(notifications => {
          notifications.forEach(notification => notification.close());
      });
  }).catch(err => {
      console.error('Failed to send notification via Service Worker:', err);
  });
};

function NotificationGrantMouseDownHandler(){
  Notification.requestPermission().then((result) => {
      haveWebNotificationsBeenAccepted = result === "granted";
  });

  $(document).off("click", NotificationGrantMouseDownHandler);
};

function isApop(walletData, oldWalletData){
  const currentPNL = parseFloat(walletData.global.pnl);
  const oldPNL = parseFloat(oldWalletData.global.pnl); // Ensure oldPNL is a number

  if(isNaN(currentPNL) || isNaN(oldPNL)){
    console.error("Invalid PNL values.");
    return;
  };

  const percentageChange = ((currentPNL - oldPNL) / Math.abs(oldPNL)) * 100;

  if (percentageChange >= 4.5) {
    showNotif({title: "PUMP DETECTED", body: 'ONGOING PNL +'+percentageChange.toFixed(2)});
  } else if (percentageChange <= -3.5) {
    showNotif({title: "CRASH DETECTED", body: 'ONGOING PNL -'+percentageChange.toFixed(2)});
    console.log("CRASH");
  };

  return;
};


// HANDLER FUNCTION 

function backerMousedownHandler(e){
  if(current_page == "selection" && !add_state && !timeInputShown && !rotation_state && !statOpened && !calendarState && !isExtraOut){return};
  
  const clientX = (e.type === "mousedown")
  ? e.clientX
  : e.originalEvent.touches[0].clientX;
  
  const clientY = (e.type === "mousedown")
  ? e.pageY
  : e.originalEvent.touches[0].clientY;

  backerY = clientY;

  if(clientX < DRAG_THRESHOLD){
      isBacking = true;

      $("#IOSbackerUI").css({
          transition: "none",
          "-webkit-transition": "none"
      });
  };
};

function backerMousemoveHandler(e){
    if (!isBacking) return;
    
    const pointerX = (e.type === "mousemove")
    ? e.pageX
    : e.originalEvent.touches[0].pageX;

    backerX = pointerX;

    const windowH = $(window).innerHeight();

    const upperBound = Math.max(0, backerY - Math.round(windowH * 0.30)); 
    const lowerBound = Math.min(windowH, backerY + Math.round(windowH * 0.30)); 
    
    const highCurveHandleX = Math.min(pointerX, MAX_PULL);
    const highCurveHandleY = backerY;
    const lowCurveHandleX = Math.min(pointerX, MAX_PULL);
    const lowCurveHandleY = backerY;

    const pathData = `M 0 ${upperBound} C ${highCurveHandleX} ${highCurveHandleY} ${lowCurveHandleX} ${lowCurveHandleY} 0 ${lowerBound}`;

    $("#IOSbackerUI").css({
        "clip-path": `path("${pathData}")`,
        "-webkit-clip-path": `path("${pathData}")`
    });
};

function backerMouseupHandler(){
    if (!isBacking) return;
    isBacking = false;
    
    $("#IOSbackerUI").css({
        transition: "clip-path 0.3s ease, -webkit-clip-path 0.3s ease",
        "-webkit-transition": "clip-path 0.3s ease, -webkit-clip-path 0.3s ease",
    });

    const windowH = $(window).innerHeight();

    const upperBound = Math.max(0, backerY - Math.round(windowH * 0.40)); 
    const lowerBound = Math.min(windowH, backerY + Math.round(windowH * 0.40)); 

    const pathData = `M 0 ${upperBound} C 0 ${backerY} 0 ${backerY} 0 ${lowerBound}`;

    $("#IOSbackerUI").css({
        "clip-path": `path("${pathData}")`,
        "-webkit-clip-path": `path("${pathData}")`
    });

    if(backerX >= MAX_PULL){
        const event = new CustomEvent('backed', { bubbles: true });
        $('#IOSbackerUI')[0].dispatchEvent(event);
    };
};

// -------

function pnl(){

  // EVENT HANDLERS

  $(document).on('click', '.profile_connect', function(){
      openConnect();
  });

  $(document).on('click', '.detail_connect', function(){
    if($(this).text() == "RETRY"){
      refreshData();
    }else{
      openConnect();
    };
  });

  $('.detail_select').on('change', function(){
    params['filter']['var'] = $("#sortingVar").val();
    params['filter']['way'] = $("#sortingWay").val();

    params_save(params);
    refreshData(true);
  });

  $('.refresh').on('click', function(){
    if(!isFetching && isLogged){
      refreshData();
    };
  });

  $('.blurBG').on('click', function(e){
      if(!$(e.target).is(this)){return}
      closeConnect();
  });
  
  $('.connect_submit').on('click', function(e){
      let api = $('#api_key-val').val();
      let secret = $('#api_secret-val').val();

      if(api != "" && secret != ""){
          if(!isObfuscated(api)){
            API["API"] = api;
            API["SECRET"] = secret
  
            isLogged = true;
            api_save(API);
            
            closeConnect();
            getDataAndDisplay();
          }else{
            closeConnect();
            getDataAndDisplay();
          };
      };
  });

  $('.connect_disconnect').on('click', function(){
    if(isLogged){
      clearData();
      closeConnect();
      firstLog = true;
    };
  });

  $('.autoRefreshing').on('click', function(){
    if(params['autoRefresh']){
      $('.autoRefreshing').css({
        'backgroundColor': 'var(--light-color)',
        'color': 'white'
      });

      stopTimeout();
    }else{
      $('.autoRefreshing').css({
        'backgroundColor': 'var(--yellow)',
        'color': 'black'
      });

      startTimeout(params['refreshTime']);
    };

    params['autoRefresh'] = !params['autoRefresh'];
    params_save(params);
  });

  $('.connect_element_input').on('click', function(){
    this.setSelectionRange(0, this.value.length);
  });

  if(document.visibilityState === 'hidden'){
    if(params['autoRefresh']){stopTimeout()};
  }else if(document.visibilityState === 'visible'){
    if(!isFetching && isLogged){
      refreshData();
    };
  };

  if(isMobile){
    $('#IOSbackerUI').css('display', "block");

    $(document).on("touchstart", backerMousedownHandler);
    $(document).on("touchmove", backerMousemoveHandler);
    $(document).on("touchend", backerMouseupHandler);

    $('#IOSbackerUI').on('backed', function(){
        goBack();
    });
  }else{
    $('#IOSbackerUI').remove();
  };

  $(document).on("click", NotificationGrantMouseDownHandler);

  // GRAPHIC UPDATE

  document.oncontextmenu = function(){return false};
  $('img').attr('draggable', false);

  // INIT

  API = api_read();
  params = params_read();

  if(isLogged){
    firstLog = false;
    $('#api_key-val').val(API['API']);
    $('#api_secret-val').val(API['SECRET']);

    initDOMupdate(true);
    getDataAndDisplay(false);
  }else{
    initDOMupdate(false);
  };
};

//RUN
$(document).ready(function(){pnl()})