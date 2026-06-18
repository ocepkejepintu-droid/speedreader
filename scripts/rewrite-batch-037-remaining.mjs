#!/usr/bin/env node
/**
 * Apply deep rewrites for batch 037 files that still mirror Headway backup text.
 * Reads backup, writes paraphrased chapter bodies at similar length.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = path.join(ROOT, 'summaries-data');
const BACKUP = path.join(ROOT, 'summaries-data-headway-backup');
const TS = 1781625600000;

function wc(text) {
  return String(text || '').split(/\s+/).filter(Boolean).length;
}

function save(id, meta, chapters) {
  const orig = JSON.parse(fs.readFileSync(path.join(BACKUP, `${id}.json`), 'utf8'));
  let total = 0;
  const out = {
    id,
    title: orig.title,
    author: orig.author,
    type: orig.type,
    addedAt: orig.addedAt,
    source: 'rsvp-original',
    rewrittenAt: TS,
    chapters: chapters.map((ch, i) => {
      const wordCount = wc(ch.text);
      total += wordCount;
      return { title: ch.title, text: ch.text, wordCount };
    }),
    totalWords: total,
  };
  fs.writeFileSync(path.join(DATA, `${id}.json`), JSON.stringify(out, null, 2) + '\n');
  for (const [i, ch] of out.chapters.entries()) {
    const owc = wc(orig.chapters[i].text);
    const ok = ch.wordCount >= owc * 0.75 && ch.wordCount <= owc * 1.25;
    if (!ok) console.warn(`${id} ch${i} length ${ch.wordCount} vs ${owc}`);
  }
  console.log(`wrote ${id}.json (${total} words)`);
}

// real-artists-dont-starve — full paraphrase
save('real-artists-dont-starve', {}, [
  {
    title: 'Creativity and prosperity can coexist',
    text: `Harvard scholar Rab Hatfield combed Michelangelo's accounts and found a different story than the starving-genius myth. The Sistine Chapel master lived simply yet died rich—not a cautionary van Gogh figure.

French writer Henri Murger's "Scenes" romanticized broke bohemians; son of service workers, he resented talented peers who could not monetize craft. That trope still warns creatives to shrink ambition.

The starving-artist narrative is false and deserves retirement.

Humans often pick mediocrity because it feels safer. Risk aversion pushes us toward conventional careers and away from passion.

Upcoming chapters map an alternative: earn while creating, treat vocation as art, and model a New Renaissance for the next generation. Michelangelo helped elevate artists from laborers to cultural authorities; you can extend that shift by studying working creatives today. Everyone carries creative capacity; seriousness means choices and habits, not performative struggle.

Did you know? Michelangelo's estate would equal roughly $47 million today.`,
  },
  {
    title: 'Twelve principles of the New Renaissance',
    text: `The New Renaissance names today's creatives who prosper while making meaningful work. Principles translate across contexts; thriving artists internalize recurring laws:

• Artists are built through practice, not birth lottery.
• Borrow from surroundings instead of chasing empty originality.
• Adopt growth mindset rather than "talent is enough."
• Stay flexible on tactics, stubborn on vision.
• Step into visibility to attract clients.
• Embed in creative communities.
• Collaborate generously.
• Work in public view.
• Charge for output.
• Guard ownership of IP.
• Stack multiple skills beyond one craft.
• Earn money to fund more art.

Cluster them as mindset, market, and money.

Meaningful careers run on guiding principles.

Network deliberately with allies who amplify your work—but attention only counts when it converts to income.`,
  },
  {
    title: 'Reshaping beliefs about artistic work',
    text: `Following a dream can terrify once you've invested years on a path. Identity hardens around past choices.

Self-discovery precedes vocation clarity. Release outdated self-stories; author new ones. Reinvention may cost comfort yet remains possible at any age.

We break rules to set rules.

Creativity expands when conventions crack. Psychologist Paul Torrance linked nonconformity with creative strength—rule-following systems often smother people who do not understand the rules they obey. Break them to make room for original work.

Recreate yourself imaginatively before you can recreate your art.

Before you can create great art, you first have to create yourself. ~ Jeff Goins

Beliefs mirror social feedback. Drop inherited labels; take small risks toward a thriving-artist identity. Each step surfaces new friction—becoming is ongoing, never finished.

Great artists refuse repeated routines expecting new outcomes. They reinvest, compound skills, and iterate identity.

Reinvention unlocks better work and sharper mastery.

Leaving a stale situation beats lingering for convenience. Erase starvation thinking through incremental steps toward a truer self.`,
  },
  {
    title: 'Five habits that fuel creative excellence',
    text: `Combining old ideas into fresh insight beats chasing novelty ex nihilo. Masters study peers and predecessors until personal style emerges. Humility, study, and repetition build reputation—even when exhausting.

Thriving artists learn patiently, stay humble, and persist.

They do unglamorous work—seek mentors, accept hard training, practice daily. Starving artists isolate; thriving ones apprentice because excellence follows effort, not luck.

Hold vision stubbornly.

Stubbornness means continuing through rough patches. In creative fields it starts as liability and matures into asset—starting matters, finishing more.

Tenacity channels energy into work worth showing.`,
  },
  {
    title: 'Navigating the market as an artist',
    text: `Markets connect craft to audiences and income. Promotion and networking expose talent publicly. Influencers can accelerate or sink visibility.

Strong work gains traction when a credible advocate introduces it to strangers.

Find believers in your potential—you must earn their trust repeatedly. Influencers rarely discover you; pursue relationships patiently.

They may be neighbors, not celebrities—ordinary allies sharing modest platforms count.

Thriving artists stay teachable; starving ones pretend expertise while emptying cupboards. Learn from everyone you meet; leverage each opening.

Don't rely on what you know; reach out to experts who can transform your creative work.

Go the extra mile—relocate, over-deliver, volunteer strategically—to separate from static peers.

People and place shape outcomes more than talent alone admits.

Choose environments where your craft and lifestyle receive encouragement.`,
  },
  {
    title: 'Why collaboration powers creative careers',
    text: `Momentum needs people invested in your success.

Build networks to enter thriving-artist circles.

Talent opens doors; networks amplify reach. You need allies, not armies.

Great work does not come about through a single stroke of genius, but by the continual effort of a community. ~ Jeff Goins

Desired communities may surround you already—step out, meet peers, share work.

Prove value through service; join groups aligned with your craft.

Collaboration with like minds multiplies outcomes.

Isolation starves creativity. Historical breakthroughs usually came from small teams, not lone inventors.

Healthy competition sharpens skill—learn from masters instead of envying them. Lead, manage, and co-create with peers.

Sometimes hire professionals; aligned ambition makes numbers a force multiplier.`,
  },
  {
    title: 'Visibility and public sharing matter',
    text: `Promotion is part of the job. Hoping the world stumbles upon hidden brilliance fails. Audiences engage only with work they can see.

Thriving artists publish, invite critique, and iterate publicly.

Sharing builds attention, skill, and confidence; generosity often returns.

Risk rejection to be discovered. Treat failures as training camps on the road to mastery.

Practice separates thriving from merely striving—start now, not when conditions feel perfect. Cartoonist Stephanie Halligan drew daily for two years, documenting growth for her audience. Practice in public; loyalty follows.`,
  },
  {
    title: 'Money, dignity, and ownership of your work',
    text: `Thriving artists treat income as fuel; starving artists flee fees and keep working gratis.

Charging sustains output and signals professionalism. Unpaid internships correlate with worse job outcomes—NACE surveyed 9,200 students: 63.1% with paid internships received offers versus 37% unpaid, often at lower pay.

Free work rarely feeds families or retires debt. Stop discounting yourself to "open doors."

Some artists claim indifference to money; pricing still affirms dignity. Unpaid labor breeds bitterness.

Cultivate the habit of owning and protecting your work to remain in control.

Long horizons beat quick sales that surrender control. Patient artists retain rights, refuse premature buyouts, and preserve freedom.

Ownership buys you freedom.`,
  },
  {
    title: 'Conclusion',
    text: `Artists aim to thrive, not merely survive—mindset, training, exposure, and fair pay enable that.

Wandering focus can feed a portfolio mindset: think in bodies of work, not single pieces. Diverse interests may fuse into substantial catalogs; distraction sometimes sparks innovation.

Procrastination blocks skill stacking. Success compounds slowly—design attractive portfolios and build the world you want.

Technology removes queues and multiplies reach when used deliberately. Gifts plus tools can yield undeniable momentum.

Choose the thriving-artist path: meaningful work and sustainable income coexist.

Try this

• Meet like-minded people and learn from them.
• Expand your network.
• Ensure constant practice and get feedback on your work.
• Do not be afraid to charge a fee for your services.`,
  },
]);