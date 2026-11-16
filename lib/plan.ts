// The farm plan: what a reader does about one protocol on the board, in concrete steps.
//
// A plan is derived from the protocol's own record (its category, its chains, its TVL, its growth and
// how long DefiLlama has tracked it with no token), never from a hand-written list of names: the same
// function writes every row's plan. Each step names what it costs and how long it takes, and the last
// steps say when to check the record for a launch and when to give up and rotate.
//
// A plan is not advice and no yield is promised: it is the position a farming reader would take, sized
// from the protocol's own TVL so a thin protocol is not farmed with a large ticket.

import type { SnapshotProtocol, Valuation } from './model.ts';

/** How much capital one position needs, from the protocol's own TVL: thin protocols get a small ticket. */
export function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 250_000_000) return 100;
  if (tvl >= 50_000_000) return 75;
  return 50;
}

/** The gas a deposit costs on the protocol's own chain, in whole dollars, from its TVL's size band. */
export function gasFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 12;
  if (tvl >= 1_000_000_000) return 9;
  if (tvl >= 250_000_000) return 6;
  return 4;
}

/** A dollar figure as the plans write it: whole dollars, no cents, thousands separated. */
export function usd(amount: number): string {
  return `$${Math.round(amount).toLocaleString('en-US')}`;
}

/** The first chain a record names, or a neutral phrase when it names none. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The other chains a record names after the first, for a multi-chain position's second leg. */
function otherChains(p: SnapshotProtocol): string[] {
  return p.chains.slice(1, 3);
}

/** The position's qualifying action, by the category the snapshot names. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return `Deposit ${usd(capital)} of USDC into one of ${name}'s curated vaults on ${chain} and keep the vault shares in the wallet that deposited.`;
  if (c.includes('lending') || c.includes('collateral market')) return `Supply ${usd(capital)} of USDC to ${name} on ${chain}, then borrow at most half of it against the deposit so the position keeps a health factor above 2.`;
  if (c.includes('cdp') || c.includes('stablecoin')) return `Mint a stablecoin against ${usd(capital)} of the collateral ${name} takes on ${chain}, and hold the minted units in the same wallet.`;
  if (c.includes('basis') || c.includes('derivative') || c.includes('perp') || c.includes('perpetual')) return `Deposit ${usd(capital)} of USDC as margin on ${name} on ${chain} and keep one small, hedged position open rather than trading in and out.`;
  if (c.includes('dex') || c.includes('farm') || c.includes('yield') || c.includes('liquidity')) return `Provide ${usd(capital)} of liquidity to the pair ${name} prices most on ${chain}, and keep the LP position rather than withdrawing after the first day.`;
  if (c.includes('rwa')) return `Mint or subscribe ${usd(capital)} of ${name}'s yield-bearing asset on ${chain} and hold the receipt token in the farming wallet.`;
  if (c.includes('insurance')) return `Buy ${usd(capital)} of cover from ${name} on ${chain} for a position you already hold, and keep the policy and its renewal date.`;
  if (c.includes('bridge')) return `Bridge ${usd(capital)} of USDC through ${name} to ${chain} and use the funds in one of that chain's protocols, so the route itself counts as activity.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake ${usd(capital)} of the chain's staking asset through ${name} on ${chain} and keep the liquid receipt it issues.`;
  if (c.includes('index')) return `Buy ${usd(capital)} of ${name}'s index on ${chain} and hold the index token rather than trading its constituents.`;
  if (c.includes('payment')) return `Open a channel or a balance on ${name} on ${chain}, move ${usd(capital)} through it, and leave a standing balance in the wallet.`;
  if (c.includes('governance') || c.includes('incentive')) return `Lock ${usd(capital)} with ${name} on ${chain} to earn its incentives, and vote with the position each time a proposal opens.`;
  if (c.includes('prediction') || c.includes('market')) return `Fund ${usd(capital)} to ${name} on ${chain} and keep two opposing positions open so both sides of its book are used.`;
  if (c.includes('chain') || c.includes('rollup')) return `Bridge ${usd(capital)} of USDC to ${name} and use its own applications, keeping the balance on the chain rather than round-tripping it.`;
  return `Deposit ${usd(capital)} of USDC into ${name} on ${chain}, use the service once, and keep the position open in the same wallet.`;
}

/** The watch a farmer keeps on a protocol's record before a token is announced. */
function watchLine(p: SnapshotProtocol): string {
  return `Once a day, check ${p.name}'s own documentation page, its announcement channel and its DefiLlama record: a token shows up there first as a symbol and a market cap in a field that is empty today. Cost: nothing but the attention. Time: 5 minutes a day, or 20 minutes if you write the entries into the farm log.`;
}

/**
 * A protocol's farm plan, as the strings board.json carries and the page shows: each step an action
 * with what it costs and how long it takes. `v` supplies the implied value the plan is sized against,
 * and `rank`/`total` the board's own place for the row, so the plan can say what the ticket is worth
 * against the protocol's size.
 */
export function farmPlan(p: SnapshotProtocol, v: Valuation, rank: number, total: number): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p.tvl_usd);
  const gas = gasFor(p.tvl_usd);
  const weekly = Math.max(25, Math.round(capital / 4));
  const hold = p.tvl_usd >= 1_000_000_000 || (v.age !== null && v.age >= 730) ? 30 : p.tvl_usd >= 100_000_000 ? 45 : 60;
  const others = otherChains(p);
  const tvl = usd(p.tvl_usd / 1_000_000 >= 1000 ? p.tvl_usd : p.tvl_usd);
  const growth =
    p.change_7d === null
      ? 'its seven-day change is unreported, so treat the position as a flat one'
      : `its TVL is ${p.change_7d >= 0 ? 'up' : 'down'} ${Math.abs(p.change_7d).toFixed(1)}% over seven days, so ${
          p.change_7d >= 15 ? 'expect a busier app than its size suggests' : p.change_7d <= -15 ? 'check that the fall is the market and not a withdrawal by one depositor' : 'size the ticket to the TVL rather than to the move'
        }`;

  const share = capital / p.tvl_usd;
  const shareText = share >= 0.0001 ? `${(share * 100).toFixed(3)}% of its TVL` : `${(share * 1e6).toFixed(2)} parts per million of its TVL`;
  const steps: string[] = [
    `Open a wallet used only for this farm on ${chain}, write its seed phrase down offline and fund it with the ticket alone. Cost: ${usd(gas)} of gas to fund and first-use fees on ${chain}. Time: 10 minutes.`,
    `${actionFor(p, capital, chain)} Cost: ${usd(capital)} of capital plus about ${usd(gas)} of gas for the deposit. Time: 15 minutes to set it up and open the position.`,
    `Keep the ticket to ${usd(capital)}: the board ranks ${p.name} ${rank} of ${total} on an implied value of ${usd(v.implied)}, and this ticket is ${shareText}, so a position this size cannot move the protocol or the launch's terms - never add to it on a rumour. Cost: nothing to size it this way. Time: 5 minutes to check the figures.`,
    others.length > 0 && !p.chains.includes('Ethereum')
      ? `Keep the ticket inside ${chain} and only bridge to ${others.join(' or ')} if the position has to sit there: use each chain's official bridge, and keep every bridging receipt with the position's notes. Cost: ${usd(gas + 2)} of gas and bridge fees. Time: about 30 minutes.`
      : `Fund the position with ${usd(capital)} of USDC from ${chain}, and keep the deposit transaction hash in a file beside the plan so the position can be unwound later. Cost: ${usd(gas)} of gas. Time: 15 minutes to set up.`,
    `${p.name} holds ${tvl} of TVL and ${growth}. Make one more qualifying action a week - a deposit, a borrow, a swap or a vote - sized at about ${usd(weekly)}, so the wallet's history spans more than one snapshot of its own accord. Cost: about ${usd(gas / 2 + 2)} of gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days before withdrawing anything: a wallet that farms for a week and leaves is the one a launch leaves out. Cost: the ${usd(capital)} stays in the position, earning whatever the protocol itself pays. Time: ${hold} days.`,
    watchLine(p),
    `Review the position after ${v.age === null ? 60 : Math.max(30, Math.min(120, Math.round(v.age / 8)))} days: if no token has been announced and the TVL has fallen by more than a third from ${tvl}, withdraw, bridge back and move the capital to the next protocol on this board's first page. Cost: withdrawal and bridge fees, about ${usd(gas + 2)}. Time: 20 minutes to unwind.`,
  ];
  return steps;
}
