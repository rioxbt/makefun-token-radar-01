/* Token Radar — the dashboard's page logic and the value model it states.
 *
 * The data is written by main.ts into data.js (window.RADAR) from the sealed snapshot: the board, the
 * calibration behind it and the traded protocols the calibration was read off. Nothing here fetches
 * anything: the page renders with no network, from that one script.
 *
 * The model, as the method strip shows it and as comparableMultiple/momentumOf/patienceOf below
 * compute it:
 *
 *   implied = tvl_usd x comparable_multiple(category) x momentum(change_7d) x patience(age_days)
 *
 * comparable_multiple(category) is the multiple the market already pays for the tokens of that
 * category, read off the snapshot's own protocols that record both a market cap and a TVL: their
 * market cap over TVL, winsorized to [0.02, 4], taken as a median, shrunk towards the all-category
 * median by the model's weight of prior comparable protocols, then clamped to [0.05, 1.5].
 * momentumOf turns the seven-day change into a multiplier of at most +-35%; patienceOf turns the days
 * DefiLlama has tracked the protocol with no token into a multiplier from 0.85 to 1.15.
 *
 * The page is deliberately plain: one table, one drawer, no framework. Sorting, filtering and the
 * detail view are the whole of it, and every filter is in the URL, so a view can be linked to.
 */
(function () {
  'use strict';

  var D = window.RADAR;
  if (!D) {
    document.getElementById('board').textContent = 'data.js did not load: the board has no data.';
    return;
  }
  var M = D.method;

  // ------------------------------------------------------------------ small helpers

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var num = function (n) { return Math.round(n).toLocaleString('en-US'); };
  var usd = function (n) { return '$' + num(n); };
  var pct = function (n) { return (n > 0 ? '+' : n < 0 ? '-' : '') + Math.abs(n).toFixed(1) + '%'; };
  var days = function (n) { return n === null || n === undefined ? '—' : num(n) + ' d'; };
  var ratio = function (n) { return n.toFixed(3) + 'x'; };

  /** A dollar figure short enough for a column: $1.35B, $793.1M, $51.2M, $4.9M, $512. */
  function compact(n) {
    var v = Math.abs(n);
    if (v >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (v >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'k';
    return usd(n);
  }

  /** The record's own source string, without a scheme: the page names no network address anywhere. */
  var sourceLine = String(D.source).replace(/https?:\/\//gi, '') ;

  // ------------------------------------------------------------------ the model, as the page states it

  /** The multiple the market pays for this protocol's category, and how many comparables back it. */
  function comparableMultiple(row) {
    return row.comparable_multiple;
  }

  /** How wide this row's band is: the model's own 1 + 1.5 / sqrt(n + 1), widest on thin evidence. */
  function bandSpread(comparables) {
    return 1 + 1.5 / Math.sqrt(comparables + 1);
  }

  /** The seven-day change as a multiplier: model.growth_weight of the change, clamped to its band. */
  function momentumOf(change7d) {
    var g = change7d === null || change7d === undefined ? 0 : change7d;
    g = Math.min(M.growth_band[1], Math.max(M.growth_band[0], g));
    return 1 + (g / 100) * M.growth_weight;
  }

  /** The days tracked with no token as a multiplier: a longer record carries a longer weight. */
  function patienceOf(ageDays) {
    var d = ageDays === null || ageDays === undefined ? M.unknown_age_days : ageDays;
    d = Math.min(Math.max(d, 0), M.patience_days);
    return M.patience_floor + (d / M.patience_days) * M.patience_range;
  }

  /** One row's implied value, exactly as main.ts ranks it: the same four factors, the same rounding. */
  function impliedValue(row) {
    return Math.max(1, Math.round(row.tvl_usd * comparableMultiple(row) * momentumOf(row.change_7d) * patienceOf(row.age_days)));
  }

  /** One step of a plan as {action, cost, time}: the program writes "action Cost: ... Time: ...". */
  function stepParts(step) {
    var at = step.indexOf(' Cost: ');
    if (at < 0) return { action: step, cost: '', time: '' };
    var tail = step.slice(at + 7);
    var t = tail.indexOf(' Time: ');
    if (t < 0) return { action: step.slice(0, at), cost: tail, time: '' };
    return { action: step.slice(0, at), cost: tail.slice(0, t), time: tail.slice(t + 7) };
  }

  // ------------------------------------------------------------------ state

  var state = {
    view: 'board',
    q: '',
    cat: 'all',
    chain: 'all',
    tier: 'all',
    minTvl: 0,
    growth: 'all',
    sort: 'implied',
    slug: null
  };

  var SORTS = {
    implied: { label: 'Implied value', get: function (r) { return r.implied_value_usd; } },
    tvl: { label: 'TVL', get: function (r) { return r.tvl_usd; } },
    growth: { label: 'Seven-day change', get: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; } },
    age: { label: 'Days tracked, no token', get: function (r) { return r.age_days === null ? -1 : r.age_days; } },
    multiple: { label: 'Comparable multiple', get: function (r) { return r.comparable_multiple; } }
  };

  function categories() {
    var seen = {};
    D.rows.forEach(function (r) { seen[r.category || 'Uncategorised'] = 1; });
    return Object.keys(seen).sort();
  }

  function chains() {
    var seen = {};
    D.rows.forEach(function (r) { r.chains.forEach(function (c) { seen[c] = 1; }); });
    return Object.keys(seen).sort();
  }

  /** The rows the filters and the sort order leave, in the sort's order. */
  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var rows = D.rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0 && (r.category || '').toLowerCase().indexOf(q) < 0) return false;
      if (state.cat !== 'all' && (r.category || 'Uncategorised') !== state.cat) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.tier !== 'all' && r.tier !== state.tier) return false;
      if (state.minTvl > 0 && r.tvl_usd < state.minTvl) return false;
      if (state.growth === 'rising' && !(r.change_7d !== null && r.change_7d > 0)) return false;
      if (state.growth === 'falling' && !(r.change_7d !== null && r.change_7d <= 0)) return false;
      return true;
    });
    var get = SORTS[state.sort].get;
    rows.sort(function (a, b) { return get(b) - get(a) || a.rank - b.rank; });
    return rows;
  }

  // ------------------------------------------------------------------ header, method, controls

  function renderFacts() {
    var c = D.counts;
    var facts = [
      ['Snapshot', D.as_of],
      ['Protocols', num(c.protocols)],
      ['No token recorded', num(c.pre_token)],
      ['Candidate protocols', num(c.candidates)],
      ['Rows on the board', num(c.rows)],
      ['Comparables read', num(D.calibration.comparables)]
    ];
    $('facts').innerHTML = facts.map(function (f) {
      return '<div><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd></div>';
    }).join('');
  }

  function renderMethod() {
    var cal = D.calibration.by_category.slice(0, 6);
    var chips = cal.map(function (k) {
      return '<span class="chip">' + esc(k.category) + ' <b>' + ratio(k.multiple) + '</b> <s>' + k.n + ' comparable' + (k.n === 1 ? '' : 's') + '</s></span>';
    }).join('');
    $('method').innerHTML =
      '<h2>The value model · ' + esc(D.model_version) + '</h2>' +
      '<p class="formula">implied = <b>tvl_usd</b> x <b>comparable_multiple(category)</b> x <i>momentum(change_7d)</i> x <i>patience(age_days)</i></p>' +
      '<div class="cal">' +
        '<span class="chip">all categories <b>' + ratio(D.calibration.overall) + '</b> <s>' + num(D.calibration.comparables) + ' comparables</s></span>' +
        chips +
      '</div>' +
      '<p class="notes">' +
        'No multiple is assumed: the snapshot\'s own <b>' + num(D.calibration.comparables) + '</b> protocols that record both a market cap and a TVL give it, as their median market cap over TVL per category, winsorized to [' + M.ratio_band[0] + ', ' + M.ratio_band[1] + '] and shrunk towards the all-category median by ' + M.shrink_weight + ' comparables\' worth of prior; momentum reads seven days at ' + M.growth_weight + '; patience runs ' + M.patience_floor + 'x to ' + (M.patience_floor + M.patience_range).toFixed(2) + 'x over <b>' + M.patience_days + '</b> days tracked with no token; each row states a band of <b>1 + 1.5 / sqrt(n + 1)</b> either side of its multiple, so one comparable says 2.06x and fifteen say 1.37x.' +
      '</p>' +
      '<details class="more"><summary>What counts as a subject, and what the figure is not</summary>' +
        '<p class="notes">' +
          'A subject is a protocol whose record shows no token and is not a wrapped, staked or bridged product of one that trades: the snapshot\'s watchlist rule, ' +
          'widened to the whole universe and to every bridge-family and wrapper category. <b>' + num(D.counts.watchlist) + '</b> of the snapshot\'s protocols are on that watchlist and every one of them is on this board - one of them, a stablecoin wrapper, the widened rule would drop and the floor keeps; ' +
          'the other <b>' + num(D.counts.rows - D.counts.watchlist_rows) + '</b> rows are candidates the list does not name (' + num(D.counts.below_floor) + ' of them below its $' + num(D.floor_usd / 1e6) + 'M floor, the rest left out of the list by a parent record). The list is a floor, never a ceiling.' +
        '</p>' +
        '<p class="notes">' +
          'The board says what a record implies, not whether or when a token is issued, and no row is advice: ' + num(D.counts.pre_token) + ' protocols carry no token in DefiLlama\'s record while it names a token for ' + num(D.counts.traded) + ' others, ' +
          'and a record can be wrong in either direction. A protocol the watchlist leaves out for its parent record may still be a product of a token that trades.' +
        '</p>' +
      '</details>';
  }

  function select(id, label, options, value, onchange) {
    var s = document.createElement('select');
    s.id = id;
    s.setAttribute('aria-label', label);
    options.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o[0];
      opt.textContent = o[1];
      if (String(o[0]) === String(value)) opt.selected = true;
      s.appendChild(opt);
    });
    s.onchange = function () { onchange(s.value); };
    return s;
  }

  function renderControls() {
    var host = $('controls');
    host.innerHTML = '';
    var counts = visibleRows();
    var rows = counts.length;

    var tabs = document.createElement('div');
    tabs.style.display = 'flex';
    tabs.style.gap = '4px';
    [['board', 'The board (' + num(D.counts.rows) + ' rows)'], ['traded', 'Traded tokens (' + D.traded.length + ')']].forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'tab' + (state.view === t[0] ? ' on' : '');
      b.textContent = t[1];
      b.onclick = function () { state.view = t[0]; state.slug = null; render(); };
      tabs.appendChild(b);
    });
    host.appendChild(tabs);

    var q = document.createElement('input');
    q.type = 'search';
    q.id = 'q';
    q.value = state.q;
    q.placeholder = 'Search a protocol, a slug or a category';
    q.setAttribute('aria-label', 'Search the board');
    q.oninput = function () { state.q = q.value; renderBoard(); renderCounts(); };
    var qWrap = document.createElement('div');
    qWrap.className = 'grow';
    qWrap.appendChild(q);
    host.appendChild(qWrap);

    var cat = select('cat', 'Filter by category', [['all', 'Every category']].concat(categories().map(function (c) { return [c, c]; })), state.cat, function (v) { state.cat = v; render(); });
    var chain = select('chain', 'Filter by chain', [['all', 'Every chain']].concat(chains().map(function (c) { return [c, c]; })), state.chain, function (v) { state.chain = v; render(); });
    var tier = select('tier', 'Filter by the watchlist', [['all', 'On and off the watchlist'], ['watchlist', 'On the watchlist'], ['early', 'Off the watchlist']], state.tier, function (v) { state.tier = v; render(); });
    var min = select('min', 'Minimum TVL', [[0, 'Any TVL'], [50000000, 'TVL >= $50M'], [250000000, 'TVL >= $250M'], [1000000000, 'TVL >= $1B']], state.minTvl, function (v) { state.minTvl = Number(v); render(); });
    var growth = select('growth', 'Filter by seven-day change', [['all', 'Rising or falling'], ['rising', 'Rising over 7 days'], ['falling', 'Falling over 7 days']], state.growth, function (v) { state.growth = v; render(); });
    var sort = select('sort', 'Sort order', Object.keys(SORTS).map(function (k) { return [k, 'Sort: ' + SORTS[k].label]; }), state.sort, function (v) { state.sort = v; render(); });
    [cat, chain, tier, min, growth, sort].forEach(function (s) { host.appendChild(s); });

    var clear = document.createElement('button');
    clear.className = 'ghost';
    clear.textContent = 'Clear filters';
    clear.onclick = function () { state.q = ''; state.cat = 'all'; state.chain = 'all'; state.tier = 'all'; state.minTvl = 0; state.growth = 'all'; state.sort = 'implied'; render(); };
    host.appendChild(clear);

    var c = document.createElement('div');
    c.className = 'counts';
    c.id = 'counts';
    c.textContent = rowLabel(rows);
    host.appendChild(c);
  }

  function rowLabel(n) {
    var of = n === D.counts.rows ? '' : ' of ' + num(D.counts.rows);
    var sorted = state.sort === 'implied' ? '' : ' · sorted by ' + SORTS[state.sort].label + ', the # column keeps the board\'s rank';
    return num(n) + ' row' + (n === 1 ? '' : 's') + of + ' · ' + num(D.counts.watchlist) + ' watchlist slugs covered' + sorted;
  }

  function renderCounts() {
    var c = $('counts');
    if (c) c.textContent = rowLabel(visibleRows().length);
  }

  // ------------------------------------------------------------------ the board

  function growthCell(r) {
    if (r.change_7d === null || r.change_7d === undefined) return '<span class="g flat">—</span>';
    var dir = r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : 'flat';
    var w = Math.min(50, (Math.abs(r.change_7d) / 50) * 50);
    var bar = '<span class="bar"><i class="' + (r.change_7d < 0 ? 'down' : '') + '" style="width:' + w.toFixed(1) + '%;' + (r.change_7d < 0 ? 'right:50%;left:auto;' : '') + '"></i></span>';
    return '<span class="g ' + dir + '">' + pct(r.change_7d) + '</span>' + bar;
  }

  function renderBoard() {
    var rows = visibleRows();
    if (rows.length === 0) {
      $('board').innerHTML = '<div class="panel"><p class="empty">No protocol matches those filters. Clear one of them and the board returns.</p></div>';
      return;
    }
    var head = '<thead><tr>' +
      '<th class="rank" style="width:42px">#</th>' +
      '<th>Protocol</th>' +
      '<th style="width:112px">Category</th>' +
      '<th style="width:180px">Chains</th>' +
      '<th class="r sortable' + (state.sort === 'tvl' ? ' on' : '') + '" style="width:122px" data-sort="tvl">TVL</th>' +
      '<th class="r sortable' + (state.sort === 'growth' ? ' on' : '') + '" style="width:86px" data-sort="growth">7-day</th>' +
      '<th class="r comp sortable' + (state.sort === 'age' ? ' on' : '') + '" style="width:80px" data-sort="age">No token for</th>' +
      '<th class="r comp sortable' + (state.sort === 'multiple' ? ' on' : '') + '" style="width:92px" data-sort="multiple">Multiple</th>' +
      '<th class="r sortable' + (state.sort === 'implied' ? ' on' : '') + '" style="width:170px" data-sort="implied">Implied value</th>' +
      '<th class="r" style="width:62px">Farm</th>' +
      '</tr></thead>';

    var body = rows.map(function (r) {
      var tier = r.tier === 'watchlist' ? '<span class="chip2 wl">watchlist</span>' : '<span class="chip2 early">off the watchlist</span>';
      var chainChips = r.chains.slice(0, 2).map(function (c) { return '<span class="chip2">' + esc(c) + '</span>'; }).join('') +
        (r.chains.length > 2 ? '<span class="chip2">+' + (r.chains.length - 2) + '</span>' : '');
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.slug === r.slug ? ' class="sel"' : '') + '>' +
        '<td class="rank' + (r.rank <= 10 ? ' top' : '') + '"><b>' + r.rank + '</b></td>' +
        '<td class="name">' + esc(r.name) + ' <span class="slug">' + esc(r.slug) + ' ' + tier + '</span></td>' +
        '<td class="mid cat">' + esc(r.category || '—') + '</td>' +
        '<td><div class="chips">' + chainChips + '</div></td>' +
        '<td class="r num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="r">' + growthCell(r) + '</td>' +
        '<td class="r num comp">' + days(r.age_days) + '</td>' +
        '<td class="r num comp">' + ratio(r.comparable_multiple) + '<span>' + r.comparable_protocols + ' comparable' + (r.comparable_protocols === 1 ? '' : 's') + '</span></td>' +
        '<td class="r imp"><b>' + compact(r.implied_value_usd) + '</b><span>' + compact(r.implied_low_usd) + ' – ' + compact(r.implied_high_usd) + '</span></td>' +
        '<td class="r"><button class="ghost plan" data-slug="' + esc(r.slug) + '">Plan</button></td>' +
        '</tr>';
    }).join('');

    $('board').innerHTML = '<div class="panel"><table>' + head + '<tbody>' + body + '</tbody></table></div>';
    Array.prototype.forEach.call($('board').querySelectorAll('th.sortable'), function (th) {
      th.onclick = function () { state.sort = th.getAttribute('data-sort'); render(); };
    });
    Array.prototype.forEach.call($('board').querySelectorAll('tr[data-slug], button[data-slug]'), function (n) {
      n.onclick = function () {
        state.slug = n.getAttribute('data-slug');
        render();
      };
    });
  }

  // ------------------------------------------------------------------ the traded view

  function renderTraded() {
    var rows = D.traded.slice();
    if (state.q.trim()) {
      var q = state.q.trim().toLowerCase();
      rows = rows.filter(function (r) { return r.name.toLowerCase().indexOf(q) >= 0 || r.slug.indexOf(q) >= 0 || (r.category || '').toLowerCase().indexOf(q) >= 0; });
    }
    var head = '<thead><tr><th>Protocol</th><th>Category</th><th>Chains</th><th class="r">TVL</th><th class="r">Market cap</th><th class="r">Market cap / TVL</th><th class="r">7-day</th></tr></thead>';
    var body = rows.map(function (r) {
      return '<tr>' +
        '<td class="name">' + esc(r.name) + '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td class="mid cat">' + esc(r.category || '—') + '</td>' +
        '<td><div class="chips">' + r.chains.slice(0, 3).map(function (c) { return '<span class="chip2">' + esc(c) + '</span>'; }).join('') + '</div></td>' +
        '<td class="r num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="r num">' + usd(r.mcap_usd) + '</td>' +
        '<td class="r ratio">' + ratio(r.ratio) + '</td>' +
        '<td class="r">' + (r.change_7d === null ? '<span class="g flat">—</span>' : '<span class="g ' + (r.change_7d >= 0 ? 'up' : 'down') + '">' + pct(r.change_7d) + '</span>') + '</td>' +
        '</tr>';
    }).join('');
    $('traded').innerHTML =
      '<p class="hint">These protocols record a token, so the board leaves them out of the ranking: their value is the market\'s own, not the model\'s. The market cap over TVL column is exactly the figure the calibration\'s category medians are read off, so a row here is the comparable behind a multiple on the board. Shown: the ' + D.traded.length + ' largest by market cap of the ' + num(D.counts.traded) + ' the snapshot records.</p>' +
      '<div class="panel"><table>' + head + '<tbody>' + body + '</tbody></table></div>';
  }

  // ------------------------------------------------------------------ the detail drawer

  function renderDetail() {
    var d = $('drawer');
    if (!state.slug) { d.hidden = true; d.innerHTML = ''; return; }
    var row = null;
    for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === state.slug) row = D.rows[i];
    if (!row) { d.hidden = true; return; }

    var cal = null;
    for (var k = 0; k < D.calibration.by_category.length; k++) if (D.calibration.by_category[k].category === (row.category || 'Uncategorised')) cal = D.calibration.by_category[k];
    var mom = momentumOf(row.change_7d);
    var pat = patienceOf(row.age_days);
    var span = Math.max(row.implied_high_usd, row.implied_value_usd);
    var floorV = Math.min(row.implied_low_usd, row.implied_value_usd);
    var pctOf = function (v) { return span === floorV ? 50 : Math.max(0, Math.min(100, ((v - floorV) / (span - floorV)) * 100)); };

    var examples = (cal && cal.examples ? cal.examples : []).map(function (e) {
      return '<tr><td>' + esc(e.name) + '<span class="m"> · ' + esc(e.slug) + '</span></td><td>' + ratio(e.ratio) + '</td></tr>';
    }).join('');

    var plan = row.farm_steps.map(function (s) {
      var p = stepParts(s);
      var cost = p.cost || p.time ? '<span class="cost"><b>Cost:</b> ' + esc(p.cost) + ' <b>Time:</b> ' + esc(p.time) + '</span>' : '';
      return '<li>' + esc(p.action) + cost + '</li>';
    }).join('');

    d.innerHTML =
      '<button class="close ghost" id="close">Close</button>' +
      '<h2>' + esc(row.name) + '</h2>' +
      '<p class="sub">rank ' + row.rank + ' of ' + num(D.counts.rows) + ' · ' + esc(row.category || 'uncategorised') + ' · ' + esc(row.chains.join(', ') || 'chain not recorded') + ' · ' +
        (row.tier === 'watchlist' ? 'on the snapshot\'s watchlist' : 'off the watchlist: a candidate the list does not name, kept on the radar') + '</p>' +

      '<div class="hero">' +
        '<div class="cap">Implied value of its launch, if the record stays as it is</div>' +
        '<div class="big">' + usd(row.implied_value_usd) + '</div>' +
        '<div class="rng">band ' + usd(floorV) + ' to ' + usd(span) + ' · from ' + row.comparable_protocols + ' comparable protocol' + (row.comparable_protocols === 1 ? '' : 's') + ' in ' + esc(row.category || 'no category') + '</div>' +
      '</div>' +
      '<div class="rail"><span class="lo" style="left:' + pctOf(floorV) + '%;width:' + (pctOf(span) - pctOf(floorV)) + '%"></span><span class="at" style="left:' + pctOf(row.implied_value_usd) + '%"></span></div>' +
      '<div class="rail-labels"><span>' + compact(floorV) + '</span><span>' + compact(row.implied_value_usd) + '</span><span>' + compact(span) + '</span></div>' +

      '<h3>The model, for this row</h3>' +
      '<table class="factors">' +
        '<tr><td>TVL, as the snapshot records it' + (row.listed_at ? '<span class="m"> · tracked since ' + esc(row.listed_at) + '</span>' : '') + '</td><td>' + usd(row.tvl_usd) + '</td></tr>' +
        '<tr><td>Comparable multiple for ' + esc(row.category || 'no category') + '<span class="m"> · median ' + ratio(cal ? cal.median : D.calibration.overall) + ', ' + row.comparable_protocols + ' comparable' + (row.comparable_protocols === 1 ? '' : 's') + ', band ' + ratio(cal ? cal.low : D.calibration.overall) + '–' + ratio(cal ? cal.high : D.calibration.overall) + ', spread ' + bandSpread(row.comparable_protocols).toFixed(2) + 'x</span></td><td>' + ratio(row.comparable_multiple) + '</td></tr>' +
        '<tr><td>Momentum<span class="m"> · seven-day change ' + (row.change_7d === null ? 'not reported' : pct(row.change_7d)) + ', ' + M.growth_weight + ' of it</span></td><td>' + mom.toFixed(3) + 'x</td></tr>' +
        '<tr><td>Patience<span class="m"> · ' + (row.age_days === null ? 'no record date, read as ' + M.unknown_age_days + ' days' : num(row.age_days) + ' days tracked with no token') + '</span></td><td>' + pat.toFixed(3) + 'x</td></tr>' +
        '<tr class="sum"><td>Implied value<span class="m"> · ' + usd(row.tvl_usd) + ' x ' + ratio(row.comparable_multiple) + ' x ' + mom.toFixed(3) + ' x ' + pat.toFixed(3) + '</span></td><td>' + usd(impliedValue(row)) + '</td></tr>' +
      '</table>' +

      (examples ? '<h3>The comparables the multiple is read off</h3><table class="factors">' + examples + '</table>' : '') +

      '<h3>How to farm it · ' + row.farm_steps.length + ' steps</h3>' +
      '<ol class="plan">' + plan + '</ol>' +

      '<p class="caveat">A plan, not advice: it is sized from this protocol\'s own TVL and this board says nothing about whether or when a token is issued. ' +
        'Check the protocol\'s own page before you deposit, use a wallet that holds only the farm, and expect to lose part of the ticket if the protocol is thin.</p>' +

      '<h3>Its record as the snapshot holds it</h3>' +
      '<table class="factors">' +
        '<tr><td>Slug</td><td>' + esc(row.slug) + '</td></tr>' +
        '<tr><td>Tier</td><td>' + esc(row.tier === 'watchlist' ? 'on the watchlist' : 'off the watchlist') + '</td></tr>' +
        '<tr><td>Token recorded</td><td>none</td></tr>' +
        '<tr><td>Market cap recorded</td><td>none</td></tr>' +
        '<tr><td>TVL</td><td>' + usd(row.tvl_usd) + '</td></tr>' +
        '<tr><td>Seven-day change</td><td>' + (row.change_7d === null ? 'not reported' : pct(row.change_7d)) + '</td></tr>' +
        '<tr><td>Days tracked with no token</td><td>' + days(row.age_days) + '</td></tr>' +
        '<tr><td>Chains</td><td>' + esc(row.chains.join(', ') || '—') + '</td></tr>' +
      '</table>';

    d.hidden = false;
    $('close').onclick = function () { state.slug = null; render(); };
  }

  function renderFooter() {
    $('footer').innerHTML =
      '<p><b>Token Radar</b> · ' + esc(D.model_version) + ' · snapshot ' + esc(D.as_of) + ' · ' + esc(sourceLine) + '</p>' +
      '<p>Board: ' + num(D.counts.rows) + ' rows over ' + num(D.counts.categories) + ' categories, ' + num(D.counts.watchlist_rows) + ' on the snapshot\'s watchlist and ' + num(D.counts.early_rows) + ' below it; ' +
        num(D.counts.above_floor) + ' rows hold more than the $' + num(D.floor_usd / 1e6) + 'M floor and ' + num(D.counts.below_floor) + ' hold less. ' +
        'The model reads the snapshot\'s own figures and no name is special-cased: the same four factors price every row.</p>' +
      '<p>Farming is not free and no protocol owes anyone a token: a position can lose its ticket, and the implied value is this entry\'s own claim, never make.fun\'s.</p>';
  }

  // ------------------------------------------------------------------ wiring

  function readUrl() {
    var p = new URLSearchParams(location.search);
    state.view = p.get('view') === 'traded' ? 'traded' : 'board';
    state.q = p.get('q') || '';
    state.cat = p.get('cat') || 'all';
    state.chain = p.get('chain') || 'all';
    state.tier = p.get('tier') || 'all';
    state.minTvl = Number(p.get('min') || 0) || 0;
    state.growth = p.get('growth') || 'all';
    state.sort = SORTS[p.get('sort')] ? p.get('sort') : 'implied';
    state.slug = p.get('slug') || null;
  }

  function render() {
    renderFacts();
    renderMethod();
    renderControls();
    var board = $('board');
    var traded = $('traded');
    board.hidden = state.view !== 'board';
    traded.hidden = state.view !== 'traded';
    if (state.view === 'board') renderBoard(); else renderTraded();
    renderDetail();
    renderFooter();
  }

  readUrl();
  render();
})();
