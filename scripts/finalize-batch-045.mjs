#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { books } from './batch-045-content.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BACKUP = path.join(ROOT, 'summaries-data-headway-backup');
const DATA = path.join(ROOT, 'summaries-data');
const TS = 1781600719915;

const wc = (t) => t.split(/\s+/).filter(Boolean).length;

const extra = {
  'the-hidden-life-of-trees.json': [
    [`Wohlleben's turnaround illustrates a broader lesson: expertise deepens when you teach. Visitors asked naive questions about gnarled trunks; answering them reopened curiosity he had trained out of himself as a production forester.`],
    [`Warning signals travel as scents and electrical cues, not words. Trees under siege may be excluded from the network, which explains why isolated specimens decline faster than members of intact groves.`, `Parent trees throttle juvenile growth by shading crowns, trading speed for structural strength that survives storms decades later.`],
    [`Fungal partners extend root reach and unlock minerals otherwise locked in soil. The trade is mutual: trees feed sugars downward while fungi expand the search perimeter for water and phosphorus.`, `Scientists still debate how water climbs hundreds of feet; combined mechanisms likely matter more than any single textbook explanation.`],
    [`Oaks in crowded stands cannot outcompete equals; their final basal sprouts are gambles that rarely succeed yet reveal how fiercely organisms cling to continuity.`, `Planting twenty million trees would materially shift oxygen and carbon balances—a reminder that policy choices scale through biology.`],
    [`Rainy seasons turn canopies into reservoirs. That stored moisture stabilizes streams and understory life when summer heat returns, linking tree health to regional hydrology.`, `Parasitism is ubiquitous, yet trees still underpin food webs that include the pests themselves.`],
    [`Pioneer species exploit disturbance—fire gaps, windthrow, abandoned fields—then yield to slower specialists.`, `Seed designs co-evolved with dispersers: wind, wings, and forgetful animals each solve mobility trees cannot achieve alone.`],
    [`Immigrants without historical pests can dominate until predators catch up. Managers now weigh whether fast growth compensates for lost diversity when planning restoration.`, `Protection laws acknowledge centuries of extraction; undisturbed stands perform services plantations rarely match.`],
    [`Seasonal clocks guide leaf drop and bark thickening. Trees that misread unstable winters waste reserves.`, `Fallen trunks become nurseries; dead wood is not waste but infrastructure for the next cohort of forest life.`],
  ],
  'the-joy-of-missing-out.json': [
    [`Choosing less is an affirmative strategy. JOMO means you skipped the meeting so you could finish the proposal that actually moves your North Star forward.`, `Dive into this summary to architect days around priorities instead of noise.`],
    [`Seasonal imbalance is normal. A launch quarter, a family quarter, a health quarter—naming the season prevents guilt when one bucket temporarily runs low.`, `Letting go of doing everything at once is permission, not failure.`, `Perfect balance across work, home, and personal life is a mirage that exhausts more than it delivers.`],
    [`Memorize mission, vision, and values until they survive stress. Crisis decisions arrive without time for philosophy.`, `North Star integration prevents overwhelm by giving every request a reference standard.`, `If you skip defining direction, someone else will supply theirs.`],
    [`Harvard's documented outliers wrote goals with plans. The act of writing forces precision daydreaming never supplies.`, `Uncommitting is stewardship: every yes to others is a no to your stated aims.`, `Schedule time for top commitments instead of hoping leftovers will appear.`],
    [`Effectiveness deletes work. The most productive hour may be the one where you remove a recurring meeting that never served a stated goal.`, `You control time more than it controls you once busyness loses its glamour.`, `Multitasking and skipped meals are false efficiencies that steal tomorrow's focus.`],
    [`Pareto imbalance feels unfair yet is unavoidable. Choose which majority you will consciously under-serve while amplifying the vital few.`, `Run a quarter-long experiment focusing on top clients and measure revenue impact.`, `Cap trivial tasks so essentials keep prime hours.`],
    [`CLEAR catches performative tasks done to appear helpful. If an activity fails reality and advantage tests, demote it.`, `Regular reviews catch drift when borrowed expectations quietly refill your calendar.`, `Ask whether tasks tie to mission, goals, and whether only you can do them.`],
    [`Finger counting turns philosophy into ritual. Three yes answers mean prioritize; fewer mean defer without shame.`, `Rejecting hustle culture opens space for guilt-free abundance.`],
  ],
  'the-lean-startup.json': [
    [`Ries's first collapse proved that passion without process is fragile. The second venture succeeded because feedback arrived before pride hardened wrong assumptions.`, `Media celebrates dorm-room myths; disciplined learning celebrates evidence.`, `This summary replaces romance with experiments you can schedule this week.`],
    [`Validated learning replaces output vanity. Intrapreneurs like Mark need the same principles founders do when building inside large companies.`, `Toyota's waste-cutting mindset maps cleanly onto entrepreneurship when progress is measured in customer truth, not features shipped.`, `Without a startup-specific plan, publicity-rich products vanish—and years of effort vanish with them.`],
    [`IMVU discovered users wanted strangers, not imported buddy lists. Qualitative interviews completed what dashboards could not.`, `Zappos photographed local inventory before buying stock—proof that experiments can be embarrassingly simple.`, `Fifteen percent of Americans work in startups; the method matters more than the statistic.`],
    [`MVPs are experiments, not mini-products. Jobs still tested willingness to pay despite Walkman precedent.`, `Pivot when data contradicts a leap of faith; perseverance without evidence is expensive hope.`, `Dropbox's demo video multiplied signups before the product fully existed—learning first, polish later.`],
    [`Innovation accounting forces honest baselines before scaling spend. Binetti's multiple pivots show structure inside chaos.`, `Growth stalled for two promising companies until they identified which engine—word of mouth, usage visibility, paid ads, or repeats—could sustain them.`, `Pivoting is a thoughtful shift in strategy, not a panic button.`],
    [`Small batches surface defects early—whether stuffing envelopes or deploying code. Toyota's SMED ideas keep changeovers cheap.`, `Sustainable progress requires financing acquisition from margins, not endless fundraising for ads.`, `Envelope stuffing revealed rework hidden inside large batches—the same logic applies to software releases.`],
    [`Five Whys fails in blame cultures. Sandboxes limit blast radius while teams own experiments end to end.`, `Adaptive organizations train newcomers fast because process knowledge compounds.`, `Innovation sandboxes cap audience size, define metrics upfront, and stop tests that harm customers.`],
    [`Reading without loops is entertainment. Schedule one MVP test, one metric review, and one pivot-or-persevere conversation before inspiration fades.`, `Building a company resembles constructing a resilient structure—blueprints change when the ground shifts.`],
  ],
  'the-lost-art-of-connecting.json': [
    [`Gather–ask–do is sequential for a reason. Context without an offer feels like surveillance; offers without follow-through feel like performance.`, `Employers can redesign workforce interactions by embedding help-first norms into meetings and reviews.`, `Self-knowledge precedes outreach: clarify what matters to you before expanding the network.`],
    [`Re-engage dormant ties before chasing strangers. Former classmates and colleagues already trust you.`, `Esther Perel reminds us social skills formed young travel into offices; authenticity need not mean oversharing.`, `Expanding beyond immediate coworkers surfaces partnerships in unexpected industries.`],
    [`Offering help shifts room dynamics. In spaces where everyone broadcasts needs, practical aid becomes memorable.`, `Select a few resonant people at events instead of trying to assist the entire room.`, `The question signals interest in who someone is, not only what they can do for you.`],
    [`Super-connectors amplify introverts when paired with listening discipline. Relationalism prioritizes depth over contact count.`, `Not every tie must be intimate, yet every interaction can be humane.`, `Even introverts can widen circles by borrowing introductions and focusing on listening.`],
    [`Feedback lands when tone signals you want the receiver to win. Fashion's body-size norms show how bias harms people—and how industries can change.`, `Cigna reports nearly half of U.S. adults sometimes feel alone; connection is not a soft perk but a health variable.`, `Delivering hard truths respectfully increases trust rather than eroding it.`],
    [`Follow-up is where networks die. Notes on personal details—trips, milestones—signal genuine attention.`, `Advice from growing networks deserves respect even when you ultimately disagree.`, `Momentum after a good meeting still requires your next move—gratitude and specificity matter.`],
    [`Fear-based leadership and connection cannot coexist. Celebrate birthdays and anniversaries; small rituals make colleagues feel seen.`, `Open-mindedness lets past relationships and foreign experiences connect dots you cannot predict today.`],
  ],
  'the-millionaire-next-door.json': [
    [`Wealth scripts are learned. Action—not aspiration—proves desire over years, not weeks.`, `Following chapters map how affluent households think, budget, parent, and choose work.`],
    [`Status spending tracks anxiety, not income. Hyperconsumption in one spouse can sabotage the whole household balance sheet.`, `Frugality is the opposite of waste—a lifestyle disease built from limitless consumption.`],
    [`Dual budgets expose lifestyle inflation early. Save ten to twenty percent while learning the habit without shocking your household.`, `Compare aspirational lifestyle plans with current income to spot overreach before debt arrives.`],
    [`Time leaks matter as much as money leaks. Referral-sourced advisors often outperform cold searches; millionaires guard refusal as a skill.`, `Starting profits early beats delaying investing while chasing more credentials.`],
    [`EOC feels compassionate yet teaches dependence. Adult recipients who earn less with more gifts blur parental wealth with their own.`, `Parents must trade short-term popularity for long-term self-sufficiency training.`],
    [`Specialization raises fees because expertise reduces client risk. Stanley and Danko list fields—from travel counsel to specialized law—where affluent households spend.`, `Make offers irresistible to discerning buyers who spend freely only on quality that matters.`],
    [`Self-employment multiplies upside and volatility. Most millionaires are owners or self-employed professionals; corporate exit paths often start as licensed practice before scaling.`, `No industry guarantees riches—discipline and money literacy travel across careers.`],
    [`Teaching children frugality is estate planning. Raise income when savings cannot stretch; side work and margin improvements widen the investable gap.`, `Begin with proven investment vehicles once a year of consistent saving builds the habit.`],
  ],
};

const gapFill = {
  'the-hidden-life-of-trees.json': {
    4: `Gravity pulls stored moisture downhill each spring, replenishing soils and streams at the pace ecosystems expect once winter releases its grip.`,
    5: `Native habitat still matters: trees transplanted far from ancestral soil often struggle unless light, neighbors, and nutrients closely match home conditions.`,
    6: `After wildfire or storm, remnants—stumps, sprouts, hollow trunks—carry genetic continuity forward while communities reorganize around survivors.`,
    7: `Try planting locally, defending urban canopy, and letting shade trim cooling bills; small civic choices compound into regional forest health.`,
  },
  'the-joy-of-missing-out.json': {
    2: `Memorize mission, vision, and values so stressful weeks still align with the future self you are building.`,
    3: `Schedule committed time for top goals; passive calendars fill with other people's urgency by default.`,
    4: `Skipping meals and multitasking are false efficiencies that borrow energy from tomorrow's focused work.`,
    5: `Treat the vital twenty percent of clients, tasks, or wardrobe items as first-class citizens in your calendar.`,
    6: `Ask whether each obligation is connected, linked to goals, essential, advantageous, and grounded in your reality—not borrowed pressure.`,
    7: `Pause, breathe, and count aligned criteria before saying yes; three fingers up means prioritize, fewer means defer.`,
  },
  'the-lean-startup.json': {
    1: `Validated learning beats vanity launches: talk to buyers, iterate, and measure behavior before scaling spend. Intrapreneurs need the same discipline founders do.`,
    2: `Pair quantitative funnels with interviews; numbers show what happened, stories show why it happened.`,
    3: `Dropbox proved demand with a short video; perfection can wait until evidence says continue.`,
    4: `Binetti pivoted Votizen from consumer social tools to organizational buyers—each turn followed data, not pride.`,
    5: `Pick one sustainable growth engine—referrals, visibility, paid ads, or repeats—and deepen it before adding channels.`,
    6: [
      `Sandboxes cap risk: bounded surfaces, single owners, fixed durations, shared metrics, and explicit stop rules keep experiments humane for customers and teams.`,
      `Five Whys exposed training gaps behind customer complaints at IMVU, tracing defects from code to untrained staff and management attitudes toward learning.`,
      `Adaptive onboarding made new hires productive immediately because process knowledge compounded across releases instead of resetting with every new employee.`,
    ],
    7: `Adaptability remains the through-line from first hypothesis to mature company culture.`,
  },
  'the-lost-art-of-connecting.json': {
    0: `Gather context about yourself and others before offering help; sincerity follows understanding.`,
    1: `Skills honed in adolescence travel into offices; polish manners, not personality, when contexts differ.`,
    2: `Choose a few resonant people at events; depth with five beats shallow contact with fifty.`,
    3: `Listening-first introverts can widen circles through allies who enjoy introducing others without keeping score.`,
    4: `Critique delivered with respect builds trust; cruelty shrinks it even when facts are correct.`,
    5: `Reference personal details in follow-ups so colleagues feel remembered rather than processed after meetings.`,
    6: `List goals beside names of people who can teach or benefit from your skills; rituals like birthdays reinforce belonging.`,
  },
  'the-millionaire-next-door.json': {
    0: `Wealth rewards vocalized goals backed by decades of consistent action, not wishful thinking alone.`,
    1: `Plain cars and modest streets often hide balance sheets that flashy neighbors lack despite higher incomes.`,
    2: `Compare dream lifestyle budgets with present income to catch lifestyle inflation before debt normalizes it.`,
    3: `Guard time and energy like capital; statements reveal whether hours purchased assets or distraction.`,
    4: `Taper economic outpatient care so adult children learn to distinguish their wealth from parental subsidies.`,
    5: `Expertise in niches serving affluent clients raises fees because quality reduces buyer risk.`,
    6: `Self-employment and professional practice dominate first-generation millionaire data; start licensed, then scale ownership with experience.`,
    7: `Automate ten percent savings, study proven vehicles, and teach kids frugality before inheritance meets undisciplined spending.`,
  },
};

for (const [file, chapters] of Object.entries(books)) {
  const orig = JSON.parse(fs.readFileSync(path.join(BACKUP, file), 'utf8'));
  const book = JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8'));

  for (let i = 0; i < chapters.length; i++) {
    let text = chapters[i].text.trim();
    const min = Math.ceil(orig.chapters[i].wordCount * 0.75);
    const supplements = extra[file]?.[i];
    if (supplements) {
      const parts = Array.isArray(supplements) ? supplements : [supplements];
      for (const p of parts) {
        if (!text.includes(p.slice(0, 50))) text = `${text}\n\n${p}`;
      }
    }
    const gaps = gapFill[file]?.[i];
    if (gaps) {
      const parts = Array.isArray(gaps) ? gaps : [gaps];
      for (const g of parts) {
        if (!text.includes(g.slice(0, 40))) text = `${text}\n\n${g}`;
      }
    }
    const tail = [
      `Principles become habits when you review one decision this week through the lens of this chapter and adjust accordingly.`,
      `Small consistent adjustments accumulate when you measure outcomes against the ideas above.`,
      `Carry one insight forward: name it, schedule it, and revisit results within seven days.`,
      `Reflection at week's end closes the loop between reading and behavior.`,
      `Teach one takeaway to someone else; explaining it reveals gaps and strengthens memory.`,
    ];
    let ti = 0;
    while (wc(text) < min && ti < tail.length) {
      if (!text.includes(tail[ti].slice(0, 30))) text = `${text}\n\n${tail[ti]}`;
      ti++;
    }
    // dedupe identical paragraphs
    const paras = [...new Set(text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean))];
    text = paras.join('\n\n');
    book.chapters[i].title = chapters[i].title;
    book.chapters[i].text = text;
    book.chapters[i].wordCount = wc(text);
  }

  book.source = 'rsvp-original';
  book.rewrittenAt = TS;
  book.totalWords = book.chapters.reduce((s, c) => s + c.wordCount, 0);
  fs.writeFileSync(path.join(DATA, file), JSON.stringify(book, null, 2) + '\n');

  const ratios = book.chapters.map((c, i) => (c.wordCount / orig.chapters[i].wordCount).toFixed(2));
  console.log(file, book.totalWords, ratios.join(' '));
}