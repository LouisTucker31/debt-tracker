(function(){
  "use strict";

  /* ============================================================
     Prevent double-tap-to-zoom (a UX nicety for tap targets), but
     deliberately allow pinch-to-zoom: disabling pinch zoom removes an
     accessibility feature low-vision users rely on, so it is never
     blocked here even though it was blocked in an earlier draft.
  ============================================================ */
  var lastTouchEnd = 0;
  document.addEventListener('touchend', function(e){
    var now = Date.now();
    if (now - lastTouchEnd <= 300) e.preventDefault();
    lastTouchEnd = now;
  }, { passive:false });

  /* ============================================================
     Config
  ============================================================ */
  var CURRENCY = 'GBP';
  var LOCALE = 'en-GB';
  var STORAGE_KEY = 'debtTracker.cards.v1';
  var currencyFmt = new Intl.NumberFormat(LOCALE, { style:'currency', currency:CURRENCY, minimumFractionDigits:2, maximumFractionDigits:2 });
  var currencyFmtNoDecimals = new Intl.NumberFormat(LOCALE, { style:'currency', currency:CURRENCY, minimumFractionDigits:0, maximumFractionDigits:0 });

  function fmtMoney(n){ return currencyFmt.format(n || 0); }
  function fmtMoneyShort(n){ return currencyFmtNoDecimals.format(n || 0); }
  function round2(n){ return Math.round((n + Number.EPSILON) * 100) / 100; }
  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }

  /* ============================================================
     Date helpers: all dates stored and compared as 'YYYY-MM-DD'
  ============================================================ */
  function pad(n){ return String(n).padStart(2,'0'); }
  function toISO(d){ return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
  function parseISO(s){ var p = s.split('-').map(Number); return new Date(p[0], p[1]-1, p[2]); }
  function todayStr(){ return toISO(new Date()); }
  function daysBetween(a,b){
    var da = typeof a === 'string' ? parseISO(a) : a;
    var db = typeof b === 'string' ? parseISO(b) : b;
    return Math.round((db - da) / 86400000);
  }
  function addMonths(date, n){
    var d = new Date(date.getTime());
    var day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    var lastDay = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
    d.setDate(Math.min(day, lastDay));
    return d;
  }
  function fmtDateLong(dateOrStr){
    var d = typeof dateOrStr === 'string' ? parseISO(dateOrStr) : dateOrStr;
    return d.toLocaleDateString(LOCALE, { day:'numeric', month:'short', year:'numeric' });
  }
  function fmtDateShort(dateOrStr){
    var d = typeof dateOrStr === 'string' ? parseISO(dateOrStr) : dateOrStr;
    return d.toLocaleDateString(LOCALE, { day:'numeric', month:'short' });
  }
  function fmtDatePayoff(dateOrStr){
    var d = typeof dateOrStr === 'string' ? parseISO(dateOrStr) : dateOrStr;
    return d.toLocaleDateString(LOCALE, { day:'numeric', month:'short', year:'numeric' });
  }

  /* ============================================================
     Storage
  ============================================================ */
  function loadCards(){
    try{
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    }catch(e){ console.error('Failed to load cards', e); return []; }
  }
  function saveCards(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.cards));
  }

  var state = {
    cards: loadCards(),
    activeCardId: null
  };

  /* ============================================================
     Interest / projection engine
  ============================================================ */

  // Bring a card's balance up to date by compounding daily interest
  // from its lastAccrualDate through `throughStr`, logging the accrued
  // amount as a single history entry.
  function accrueInterest(card, throughStr){
    if (card.closed) return;
    var days = daysBetween(card.lastAccrualDate, throughStr);
    if (days <= 0) return;
    var dailyRate = card.apr / 100 / 365;
    var newBalance = card.balance * Math.pow(1 + dailyRate, days);
    var interest = newBalance - card.balance;
    newBalance = round2(newBalance);
    if (interest > 0.004){
      card.history.push({
        date: throughStr,
        type: 'interest',
        amount: round2(interest),
        note: 'Interest for ' + days + ' day' + (days > 1 ? 's' : ''),
        balanceAfter: newBalance
      });
    }
    card.balance = newBalance;
    card.lastAccrualDate = throughStr;
  }

  function bringAllCurrent(){
    var today = todayStr();
    var changed = false;
    state.cards.forEach(function(c){
      if (!c.closed && c.lastAccrualDate < today){
        accrueInterest(c, today);
        changed = true;
      }
    });
    if (changed) saveCards();
  }

  // Simulate forward from today: apply the card's monthly payment on
  // a recurring monthly cycle, with daily-compounded interest between
  // payments, until the balance is paid off (or flag as unpayable).
  function projectPayoff(card){
    if (card.balance <= 0.005) return { alreadyPaid:true };
    if (!card.monthlyPayment || card.monthlyPayment <= 0) return { noPayment:true };

    var dailyRate = card.apr / 100 / 365;

    // Quick check: does the payment even cover roughly one month's interest?
    var roughMonthlyInterest = card.balance * (Math.pow(1 + dailyRate, 30.44) - 1);
    if (card.monthlyPayment <= roughMonthlyInterest){
      return { neverPaysOff:true };
    }

    var cur = card.balance;
    var date = parseISO(todayStr());
    var totalInterest = 0;
    var months = 0;
    var maxMonths = 1200; // 100 years safety cap
    var startBalance = card.balance;

    while (cur > 0.01 && months < maxMonths){
      var nextDate = addMonths(date, 1);
      var days = daysBetween(date, nextDate);
      var newCur = cur * Math.pow(1 + dailyRate, days);
      totalInterest += (newCur - cur);
      cur = newCur;
      var pay = Math.min(card.monthlyPayment, cur);
      cur -= pay;
      months++;
      date = nextDate;

      if (months === 24 && cur > startBalance * 0.98){
        return { neverPaysOff:true };
      }
    }

    if (months >= maxMonths) return { neverPaysOff:true };

    return {
      payoffDate: date,
      totalInterest: round2(totalInterest),
      totalPaid: round2(card.balance + totalInterest),
      months: months
    };
  }

  /* ============================================================
     Rendering: home screen
  ============================================================ */
  function render(){
    document.getElementById('todayLabel').textContent = fmtDateLong(todayStr());
    renderSummary();
    renderInstallTip();
    renderCardsArea();
  }

  function renderSummary(){
    var open = state.cards.filter(function(c){ return !c.closed; });
    var totalBalance = open.reduce(function(s,c){ return s + c.balance; }, 0);
    var totalMonthly = open.reduce(function(s,c){ return s + (c.monthlyPayment || 0); }, 0);

    var soonest = null;
    var anyUnpayable = false;
    open.forEach(function(c){
      var p = projectPayoff(c);
      if (p.neverPaysOff) anyUnpayable = true;
      if (p.payoffDate && (!soonest || p.payoffDate < soonest)) soonest = p.payoffDate;
    });

    var chipCount = 2;
    var html = '';
    html += '<div class="summary-chip"><div class="label">Total debt</div><div class="value num">' + fmtMoney(totalBalance) + '</div></div>';
    html += '<div class="summary-chip"><div class="label">Payments</div><div class="value num accent">' + fmtMoney(totalMonthly) + '</div></div>';
    if (soonest){
      html += '<div class="summary-chip"><div class="label">Next payoff</div><div class="value">' + fmtDatePayoff(soonest) + '</div></div>';
      chipCount = 3;
    } else if (anyUnpayable){
      html += '<div class="summary-chip"><div class="label">Next payoff</div><div class="value danger">Review needed</div></div>';
      chipCount = 3;
    }
    var rowEl = document.getElementById('summaryRow');
    rowEl.style.gridTemplateColumns = 'repeat(' + chipCount + ', 1fr)';
    rowEl.innerHTML = html;
  }

  function renderInstallTip(){
    var el = document.getElementById('installTip');
    if (localStorage.getItem('debtTracker.installTipDismissed') || isStandalone()){
      el.innerHTML = '';
      return;
    }
    el.innerHTML =
      '<div class="install-tip">' +
        '<span>Add this to your Home Screen: tap Share, then "Add to Home Screen", to use it like an app.</span>' +
        '<button id="dismissInstallTip" aria-label="Dismiss">&times;</button>' +
      '</div>';
    document.getElementById('dismissInstallTip').onclick = function(){
      localStorage.setItem('debtTracker.installTipDismissed', '1');
      el.innerHTML = '';
    };
  }

  function isStandalone(){
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function renderCardsArea(){
    var area = document.getElementById('cardsArea');
    var open = state.cards.filter(function(c){ return !c.closed; });
    var closed = state.cards.filter(function(c){ return c.closed; });

    if (open.length === 0 && closed.length === 0){
      area.innerHTML =
        '<div class="empty-state">' +
          '<p>No cards yet.<br>Add your first card to start tracking what you owe.</p>' +
        '</div>';
      return;
    }

    var html = '<div class="grid">';
    open.forEach(function(c){ html += renderTile(c); });
    html += '</div>';

    if (open.length === 0){
      html = '<div class="empty-state"><p>All caught up. No open cards.</p></div>' + html;
    }

    if (closed.length){
      html += '<details class="closed-section"><summary>Closed cards (' + closed.length + ')</summary>';
      closed.forEach(function(c){
        html += '<div class="closed-row" onclick="DT.openCard(\'' + c.id + '\')">' +
          '<span class="cname">' + escapeHtml(c.name) + '</span>' +
          '<span>Closed ' + fmtDateShort(c.closedDate) + '</span>' +
        '</div>';
      });
      html += '</details>';
    }

    area.innerHTML = html;
  }

  function renderTile(c){
    var proj = projectPayoff(c);
    var payoffLine;
    if (proj.alreadyPaid){ payoffLine = '<div class="tile-payoff">Balance clear</div>'; }
    else if (proj.noPayment){ payoffLine = '<div class="tile-payoff">Set a monthly payment for a payoff date</div>'; }
    else if (proj.neverPaysOff){ payoffLine = '<div class="tile-payoff warn">Won\'t clear at this payment</div>'; }
    else { payoffLine = '<div class="tile-payoff">Payoff ' + fmtDatePayoff(proj.payoffDate) + '</div>'; }

    var aprHigh = c.apr >= 20;
    var barHtml = '';
    if (c.creditLimit && c.creditLimit > 0){
      var pct = Math.max(0, Math.min(100, (c.balance / c.creditLimit) * 100));
      var cls = pct >= 90 ? 'high' : (pct >= 60 ? 'mid' : '');
      barHtml = '<div class="bar-track"><div class="bar-fill ' + cls + '" style="width:' + pct.toFixed(1) + '%"></div></div>';
    }

    return (
      '<button class="tile" onclick="DT.openCard(\'' + c.id + '\')">' +
        '<div class="tile-top">' +
          '<div class="tile-name">' + escapeHtml(c.name) + '</div>' +
          '<div class="apr-badge' + (aprHigh ? ' high' : '') + '">' + c.apr.toFixed(2).replace(/\.00$/,'') + '% APR</div>' +
        '</div>' +
        '<div class="tile-balance num">' + fmtMoney(c.balance) + '</div>' +
        '<div class="tile-sub">' + (c.monthlyPayment ? fmtMoney(c.monthlyPayment) + '/mo' : 'No payment set') + '</div>' +
        barHtml +
        payoffLine +
      '</button>'
    );
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(ch){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch];
    });
  }

  /* ============================================================
     Card detail view
  ============================================================ */
  function openCard(id){
    state.activeCardId = id;
    renderDetail();
    show('detailOverlay');
  }

  function renderDetail(){
    var c = getCard(state.activeCardId);
    if (!c) return;
    document.getElementById('detailTitle').textContent = c.name;
    document.getElementById('detailEdit').style.display = c.closed ? 'none' : '';

    var proj = projectPayoff(c);
    var html = '';

    html += '<div class="detail-balance"><div class="amount num">' + fmtMoney(c.balance) + '</div><div class="name">Current balance' + (c.closed ? ' · Closed ' + fmtDateShort(c.closedDate) : '') + '</div></div>';

    if (proj.neverPaysOff){
      html += '<div class="warning-banner">At ' + fmtMoney(c.monthlyPayment) + '/month, interest is outpacing your payment, so this card will not clear. Increase the monthly payment or make a lump sum payment.</div>';
    } else if (proj.alreadyPaid && !c.closed){
      html += '<div class="success-banner">This card is paid off. You can close it from the actions below.</div>';
    }

    html += '<div class="stat-grid">';
    html += statItem('APR', c.apr.toFixed(2).replace(/\.00$/,'') + '%');
    html += statItem('Monthly payment', c.monthlyPayment ? fmtMoney(c.monthlyPayment) : 'Not set');
    if (c.creditLimit) html += statItem('Credit limit', fmtMoney(c.creditLimit));
    html += statItem('Opened', fmtDateLong(c.openDate));
    if (proj.payoffDate){
      html += statItem('Payoff date', fmtDateLong(proj.payoffDate), 'accent');
      html += statItem('Months remaining', String(proj.months));
      html += statItem('Interest remaining', fmtMoney(proj.totalInterest), 'danger');
      html += statItem('Total left to pay', fmtMoney(proj.totalPaid));
    }
    html += '</div>';

    if (!c.closed){
      html += '<div class="action-row">';
      html += '<button class="btn primary" onclick="DT.openTxForm(\'payment\')">Make a payment</button>';
      html += '<button class="btn" onclick="DT.openTxForm(\'charge\')">Add a charge</button>';
      if (c.balance > 0.005){
        html += '<button class="btn full" onclick="DT.openTxForm(\'payoff\')">Pay off in full</button>';
      }
      html += '<button class="btn full" onclick="DT.closeCard()">Close card</button>';
      html += '</div>';
    } else {
      html += '<div class="action-row">';
      html += '<button class="btn full" onclick="DT.reopenCard()">Reopen card</button>';
      html += '</div>';
    }

    html += '<div class="action-row"><button class="btn danger full" onclick="DT.deleteCard()">Delete card</button></div>';

    html += '<div class="section-heading">History</div>';
    var hist = c.history.slice().reverse();
    if (!hist.length){
      html += '<div class="no-history">No activity yet.</div>';
    } else {
      hist.forEach(function(h){ html += renderHistoryRow(h); });
    }

    document.getElementById('detailBody').innerHTML = html;
    fitOverlayBody('detailOverlay');
  }

  function statItem(label, value, cls){
    return '<div class="stat-item"><div class="label">' + label + '</div><div class="value num' + (cls ? ' ' + cls : '') + '">' + value + '</div></div>';
  }

  var TYPE_LABELS = {
    open: 'Card opened',
    payment: 'Payment',
    charge: 'Charge',
    payoff: 'Paid in full',
    interest: 'Interest accrued',
    closed: 'Card closed',
    reopened: 'Card reopened',
    adjustment: 'Balance adjusted'
  };

  function renderHistoryRow(h){
    var label = TYPE_LABELS[h.type] || h.type;
    var sign = '';
    var cls = 'neutral';
    if (h.type === 'payment' || h.type === 'payoff'){ sign = '−'; cls = 'neg'; }
    else if (h.type === 'charge' || h.type === 'interest'){ sign = '+'; cls = 'pos'; }

    var amountStr = (h.amount != null) ? sign + fmtMoney(Math.abs(h.amount)) : '';

    return (
      '<div class="history-row">' +
        '<div class="history-left">' +
          '<div class="htype">' + label + (h.note ? ' · ' + escapeHtml(h.note) : '') + '</div>' +
          '<div class="hdate">' + fmtDateLong(h.date) + '</div>' +
        '</div>' +
        '<div class="history-right">' +
          (amountStr ? '<div class="hamount ' + cls + ' num">' + amountStr + '</div>' : '') +
          (h.balanceAfter != null ? '<div class="hbalance num">Bal ' + fmtMoney(h.balanceAfter) + '</div>' : '') +
        '</div>' +
      '</div>'
    );
  }

  function getCard(id){
    return state.cards.find(function(c){ return c.id === id; });
  }

  /* ============================================================
     Add / edit card form
  ============================================================ */
  var cardFormMode = 'add'; // 'add' | 'edit'

  function openAddForm(){
    cardFormMode = 'add';
    document.getElementById('cardFormTitle').textContent = 'Add card';
    document.getElementById('cardFormBody').innerHTML = cardFormHtml(null);
    // Hard-reset every field in case the browser tries to restore
    // previously typed values into the freshly created inputs.
    ['f-name','f-principal','f-apr','f-payment','f-limit'].forEach(function(id){
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    var opendate = document.getElementById('f-opendate');
    if (opendate) opendate.value = todayStr();
    show('cardFormOverlay');
    fitOverlayBody('cardFormOverlay');
    document.getElementById('f-name').focus();
  }

  function openEditForm(){
    var c = getCard(state.activeCardId);
    if (!c) return;
    cardFormMode = 'edit';
    document.getElementById('cardFormTitle').textContent = 'Edit card';
    document.getElementById('cardFormBody').innerHTML = cardFormHtml(c);
    show('cardFormOverlay');
    fitOverlayBody('cardFormOverlay');
  }

  function cardFormHtml(c){
    var today = todayStr();
    return (
      (c ? '<div class="hint hint-standalone">Changes apply from today onward. Your past payments and history stay exactly as recorded.</div>' : '') +
      '<div class="field"><label for="f-name">Card name</label>' +
        '<input id="f-name" type="text" autocomplete="off" enterkeyhint="next" required placeholder="e.g. Barclaycard" value="' + (c ? escapeHtml(c.name) : '') + '"></div>' +

      (c ? '' :
        '<div class="field"><label for="f-principal">Starting balance</label>' +
          '<div class="prefix-input"><span>£</span><input id="f-principal" type="number" inputmode="decimal" autocomplete="off" enterkeyhint="next" step="0.01" min="0" required placeholder="0.00"></div>' +
        '</div>'
      ) +

      '<div class="field-row">' +
        '<div class="field"><label for="f-apr">APR</label>' +
          '<input id="f-apr" type="number" inputmode="decimal" autocomplete="off" enterkeyhint="next" step="0.01" min="0" max="100" required placeholder="24.90" value="' + (c ? c.apr : '') + '">' +
          '<div class="hint">% per year</div>' +
        '</div>' +
        '<div class="field"><label for="f-payment">Monthly payment</label>' +
          '<div class="prefix-input"><span>£</span><input id="f-payment" type="number" inputmode="decimal" autocomplete="off" enterkeyhint="next" step="0.01" min="0" placeholder="0.00" value="' + (c ? c.monthlyPayment : '') + '"></div>' +
        '</div>' +
      '</div>' +

      '<div class="field"><label for="f-limit">Credit limit (optional)</label>' +
        '<div class="prefix-input"><span>£</span><input id="f-limit" type="number" inputmode="decimal" autocomplete="off" enterkeyhint="done" step="0.01" min="0" placeholder="0.00" value="' + (c && c.creditLimit ? c.creditLimit : '') + '"></div>' +
        '<div class="hint">Used to show a utilisation bar on the tile</div>' +
      '</div>' +

      (c ? '' :
        '<div class="field"><label for="f-opendate">Opening date</label>' +
          '<input id="f-opendate" type="date" autocomplete="off" value="' + today + '" max="' + today + '"></div>'
      )
    );
  }

  function saveCardForm(){
    var nameEl = document.getElementById('f-name');
    var aprEl = document.getElementById('f-apr');
    var name = nameEl.value.trim();
    var apr = parseFloat(aprEl.value);
    var payment = parseFloat(document.getElementById('f-payment').value);
    var limitRaw = document.getElementById('f-limit').value;
    var limit = limitRaw ? parseFloat(limitRaw) : null;

    nameEl.setCustomValidity('');
    aprEl.setCustomValidity('');

    if (!name){
      nameEl.setCustomValidity('Give the card a name.');
      nameEl.reportValidity();
      return;
    }
    if (isNaN(apr) || apr < 0){
      aprEl.setCustomValidity('Enter a valid APR, 0 or higher.');
      aprEl.reportValidity();
      return;
    }
    if (isNaN(payment) || payment < 0){ payment = 0; }

    if (cardFormMode === 'add'){
      var principalEl = document.getElementById('f-principal');
      var principal = parseFloat(principalEl.value);
      var openDate = document.getElementById('f-opendate').value || todayStr();
      principalEl.setCustomValidity('');
      if (isNaN(principal) || principal < 0){
        principalEl.setCustomValidity('Enter a valid starting balance.');
        principalEl.reportValidity();
        return;
      }

      var card = {
        id: uid(),
        name: name,
        apr: apr,
        monthlyPayment: payment,
        creditLimit: limit,
        openDate: openDate,
        balance: round2(principal),
        lastAccrualDate: openDate,
        closed: false,
        closedDate: null,
        history: [{
          date: openDate, type:'open', amount:null,
          note:'Card added', balanceAfter: round2(principal)
        }]
      };
      state.cards.push(card);
      saveCards();
      bringAllCurrent();
      closeOverlay('cardFormOverlay');
      render();
    } else {
      var c = getCard(state.activeCardId);
      if (!c) return;

      var changes = [];
      if (c.name !== name) changes.push('Name changed to "' + name + '"');
      if (c.apr !== apr) changes.push('APR changed to ' + apr.toFixed(2).replace(/\.00$/,'') + '% (was ' + c.apr.toFixed(2).replace(/\.00$/,'') + '%)');
      if (c.monthlyPayment !== payment) changes.push('Monthly payment changed to ' + fmtMoney(payment) + ' (was ' + fmtMoney(c.monthlyPayment) + ')');
      if ((c.creditLimit || null) !== (limit || null)) changes.push('Credit limit changed to ' + (limit ? fmtMoney(limit) : 'none'));

      c.name = name;
      c.apr = apr;
      c.monthlyPayment = payment;
      c.creditLimit = limit;

      if (changes.length){
        c.history.push({ date: todayStr(), type:'adjustment', amount:null, note: changes.join('; '), balanceAfter: c.balance });
      }
      saveCards();
      closeOverlay('cardFormOverlay');
      renderDetail();
      render();
    }
  }

  /* ============================================================
     Payment / charge form
  ============================================================ */
  var txMode = 'payment'; // 'payment' | 'charge' | 'payoff'

  function openTxForm(mode){
    txMode = mode;
    var c = getCard(state.activeCardId);
    if (!c) return;
    accrueInterest(c, todayStr());
    saveCards();

    var titles = { payment:'Make a payment', charge:'Add a charge', payoff:'Pay off in full' };
    document.getElementById('txFormTitle').textContent = titles[mode];

    var defaultAmount = '';
    if (mode === 'payoff') defaultAmount = c.balance.toFixed(2);
    else if (mode === 'payment' && c.monthlyPayment) defaultAmount = c.monthlyPayment.toFixed(2);

    var quickChips = '';
    if (mode === 'payment'){
      quickChips =
        '<div class="quick-amounts">' +
          (c.monthlyPayment ? '<button type="button" onclick="DT.setTxAmount(' + c.monthlyPayment + ')">Min payment (' + fmtMoney(c.monthlyPayment) + ')</button>' : '') +
          '<button type="button" onclick="DT.setTxAmount(' + c.balance + ')">Full balance (' + fmtMoney(c.balance) + ')</button>' +
        '</div>';
    }

    var today = todayStr();
    document.getElementById('txFormBody').innerHTML =
      '<div class="field"><label for="tx-amount">Amount</label>' +
        '<div class="prefix-input"><span>£</span><input id="tx-amount" type="number" inputmode="decimal" autocomplete="off" enterkeyhint="next" step="0.01" min="0.01" required placeholder="0.00" value="' + defaultAmount + '"' + (mode === 'payoff' ? ' readonly' : '') + '></div>' +
        quickChips +
      '</div>' +
      '<div class="field"><label for="tx-date">Date</label>' +
        '<input id="tx-date" type="date" autocomplete="off" value="' + today + '" max="' + today + '"></div>' +
      '<div class="field"><label for="tx-note">Note (optional)</label>' +
        '<input id="tx-note" type="text" autocomplete="off" enterkeyhint="done" placeholder="' + (mode === 'charge' ? 'e.g. New purchase' : 'e.g. Extra lump sum') + '"></div>';

    show('txFormOverlay');
    fitOverlayBody('txFormOverlay');
    document.getElementById('tx-amount').focus();
  }

  function setTxAmount(v){
    document.getElementById('tx-amount').value = round2(v).toFixed(2);
  }

  function saveTxForm(){
    var c = getCard(state.activeCardId);
    if (!c) return;
    var amountEl = document.getElementById('tx-amount');
    var amount = parseFloat(amountEl.value);
    var date = document.getElementById('tx-date').value || todayStr();
    var note = document.getElementById('tx-note').value.trim();

    amountEl.setCustomValidity('');
    if (isNaN(amount) || amount <= 0){
      amountEl.setCustomValidity('Enter a valid amount, greater than 0.');
      amountEl.reportValidity();
      return;
    }

    accrueInterest(c, date);

    if (txMode === 'charge'){
      c.balance = round2(c.balance + amount);
      c.history.push({ date:date, type:'charge', amount: round2(amount), note: note, balanceAfter: c.balance });
    } else {
      var applied = Math.min(amount, c.balance + 0.005 > amount ? amount : c.balance);
      c.balance = round2(Math.max(0, c.balance - amount));
      c.history.push({
        date: date,
        type: txMode === 'payoff' ? 'payoff' : 'payment',
        amount: round2(amount),
        note: note,
        balanceAfter: c.balance
      });
    }

    saveCards();
    closeOverlay('txFormOverlay');
    renderDetail();
    render();

    if (c.balance <= 0.005 && !c.closed){
      askConfirm(c.name + ' is fully paid off. Close this card now?', { confirmLabel:'Close card' }).then(function(ok){
        if (ok) doCloseCard(c);
      });
    }
  }

  /* ============================================================
     Card lifecycle: close / reopen / delete
  ============================================================ */
  function closeCard(){
    var c = getCard(state.activeCardId);
    if (!c) return;
    askConfirm('Close ' + c.name + '? You can reopen it later if needed.', { confirmLabel:'Close card' }).then(function(ok){
      if (ok) doCloseCard(c);
    });
  }

  function doCloseCard(c){
    c.closed = true;
    c.closedDate = todayStr();
    c.history.push({ date:c.closedDate, type:'closed', amount:null, note:null, balanceAfter:c.balance });
    saveCards();
    renderDetail();
    render();
  }

  function reopenCard(){
    var c = getCard(state.activeCardId);
    if (!c) return;
    c.closed = false;
    c.closedDate = null;
    c.lastAccrualDate = todayStr();
    c.history.push({ date: todayStr(), type:'reopened', amount:null, note:null, balanceAfter:c.balance });
    saveCards();
    renderDetail();
    render();
  }

  function deleteCard(){
    var c = getCard(state.activeCardId);
    if (!c) return;
    askConfirm('Delete ' + c.name + ' permanently? This cannot be undone.', { confirmLabel:'Delete card', destructive:true }).then(function(ok){
      if (!ok) return;
      state.cards = state.cards.filter(function(x){ return x.id !== c.id; });
      saveCards();
      closeOverlay('detailOverlay');
      render();
    });
  }

  /* ============================================================
     Overlay plumbing
  ============================================================ */
  function show(id){ document.getElementById(id).classList.add('show'); }
  function closeOverlay(id){ document.getElementById(id).classList.remove('show'); }

  // Shrinks an overlay's body to fit the visible screen (no scrolling)
  // by scaling it down uniformly if its natural content is taller than
  // the space available below the header. Falls back to a normal
  // scroll only if content still can't fit at a sensible minimum size.
  var MIN_FIT_SCALE = 0.6;
  function fitOverlayBody(overlayId){
    var overlay = document.getElementById(overlayId);
    if (!overlay) return;
    var header = overlay.querySelector('.overlay-header');
    var body = overlay.querySelector('.overlay-body');
    if (!header || !body) return;

    body.style.transform = '';
    overlay.classList.remove('scroll-fallback');

    var headerH = header.getBoundingClientRect().height;
    var available = window.innerHeight - headerH;
    var contentH = body.scrollHeight;

    if (contentH > available && contentH > 0){
      var scale = available / contentH;
      if (scale < MIN_FIT_SCALE){
        scale = MIN_FIT_SCALE;
        overlay.classList.add('scroll-fallback');
      }
      body.style.transform = 'scale(' + scale.toFixed(4) + ')';
    }
  }

  window.addEventListener('resize', function(){
    var openOverlay = document.querySelector('.overlay.show');
    if (openOverlay) fitOverlayBody(openOverlay.id);
  });

  /* ============================================================
     Confirmation dialog
     Replaces window.confirm() with an accessible <dialog>: the
     browser handles the modal focus trap and Escape-to-cancel, and
     focus is explicitly restored to whatever triggered it on close.
  ============================================================ */
  var confirmDialogEl = document.getElementById('confirmDialog');
  var confirmMessageEl = document.getElementById('confirmMessage');
  var confirmOkBtn = document.getElementById('confirmOkBtn');
  var confirmCancelBtn = document.getElementById('confirmCancelBtn');
  var confirmResolve = null;
  var lastFocusedBeforeDialog = null;

  function askConfirm(message, opts){
    opts = opts || {};
    return new Promise(function(resolve){
      confirmResolve = resolve;
      confirmMessageEl.textContent = message;
      confirmOkBtn.textContent = opts.confirmLabel || 'Confirm';
      confirmOkBtn.className = 'btn' + (opts.destructive ? ' danger' : ' primary');
      lastFocusedBeforeDialog = document.activeElement;
      confirmDialogEl.showModal();
    });
  }

  function settleConfirm(result){
    if (confirmResolve){
      confirmResolve(result);
      confirmResolve = null;
    }
  }

  confirmOkBtn.addEventListener('click', function(){
    confirmDialogEl.close();
    settleConfirm(true);
  });
  confirmCancelBtn.addEventListener('click', function(){
    confirmDialogEl.close();
    settleConfirm(false);
  });
  // Fires when the dialog is dismissed via Escape, before 'close'.
  confirmDialogEl.addEventListener('cancel', function(){
    settleConfirm(false);
  });
  confirmDialogEl.addEventListener('close', function(){
    if (lastFocusedBeforeDialog && typeof lastFocusedBeforeDialog.focus === 'function'){
      lastFocusedBeforeDialog.focus();
    }
  });

  /* ============================================================
     Wire up static controls
  ============================================================ */
  document.getElementById('fabAdd').onclick = openAddForm;
  document.getElementById('detailBack').onclick = function(){ closeOverlay('detailOverlay'); render(); };
  document.getElementById('detailEdit').onclick = openEditForm;
  document.getElementById('cardFormCancel').onclick = function(){ closeOverlay('cardFormOverlay'); };
  document.getElementById('cardFormSave').onclick = saveCardForm;
  document.getElementById('txFormCancel').onclick = function(){ closeOverlay('txFormOverlay'); };
  document.getElementById('txFormSave').onclick = saveTxForm;

  // Recalculate live balances whenever the app regains focus / becomes
  // visible, so figures stay current if left open across midnight etc.
  document.addEventListener('visibilitychange', function(){
    if (!document.hidden){
      bringAllCurrent();
      render();
      if (state.activeCardId && document.getElementById('detailOverlay').classList.contains('show')){
        renderDetail();
      }
    }
  });

  /* ============================================================
     Expose the handful of functions used via inline onclick=""
  ============================================================ */
  window.DT = {
    openCard: openCard,
    openTxForm: openTxForm,
    setTxAmount: setTxAmount,
    closeCard: closeCard,
    reopenCard: reopenCard,
    deleteCard: deleteCard
  };

  /* ============================================================
     Boot
  ============================================================ */
  bringAllCurrent();
  render();

  if ('serviceWorker' in navigator){
    window.addEventListener('load', function(){
      navigator.serviceWorker.register('./sw.js').catch(function(err){
        console.warn('Service worker registration failed', err);
      });
    });
  }
})();
