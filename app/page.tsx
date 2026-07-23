import Link from "next/link";
import CamelotWheel from "@/components/CamelotWheel";

const DEMO_TRACKS = [
  { id: "1", fileName: "Midnight Drive.mp3", camelotKey: "8A" },
  { id: "2", fileName: "Neon Rush.mp3", camelotKey: "8B" },
  { id: "3", fileName: "Slow Burn.mp3", camelotKey: "9A" },
  { id: "4", fileName: "Afterglow.mp3", camelotKey: "5A" },
  { id: "5", fileName: "Static Bloom.mp3", camelotKey: "1B" },
];

const DEMO_CONNECTIONS = [
  { trackAId: "1", trackBId: "3", score: 90 },
  { trackAId: "1", trackBId: "2", score: 68 },
  { trackAId: "3", trackBId: "4", score: 55 },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-[var(--color-ink)]">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <span className="font-display text-lg font-bold tracking-tight text-[var(--color-paper)]">MASHMIX</span>
        <nav className="flex items-center gap-6">
          <Link href="/login" className="text-sm text-[var(--color-paper)]/70 hover:text-[var(--color-paper)] transition-colors">
            Log in
          </Link>
          <Link
            href="/signup"
            className="rounded-full bg-gradient-to-r from-[var(--color-magenta)] to-[var(--color-violet)] px-5 py-2 text-sm font-medium text-[var(--color-paper)] hover:opacity-90 transition-opacity"
          >
            Get started
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6 sm:px-10">
        <section className="grid gap-12 py-16 lg:grid-cols-2 lg:items-center lg:py-24">
          <div>
            <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-amber)]">
              Harmonic mixing, automated
            </p>
            <h1 className="mt-4 font-display text-4xl font-bold leading-[1.05] tracking-tight text-[var(--color-paper)] sm:text-5xl">
              Drop in a folder of music.
              <br />
              Find out what mixes.
            </h1>
            <p className="mt-6 max-w-lg text-base leading-relaxed text-[var(--color-paper)]/60">
              MashMix analyzes the tempo and key of every track you upload, maps
              them onto the Camelot wheel DJs use for harmonic mixing, and tells
              you exactly which songs blend — then builds the mashup for you.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/signup"
                className="rounded-full bg-gradient-to-r from-[var(--color-magenta)] to-[var(--color-violet)] px-7 py-3 font-display text-sm font-semibold text-[var(--color-paper)] hover:opacity-90 transition-opacity"
              >
                Upload your library
              </Link>
              <span className="text-sm text-[var(--color-paper)]/40">Free for your first 3 tracks</span>
            </div>
          </div>

          <div className="flex justify-center">
            <CamelotWheel tracks={DEMO_TRACKS} connections={DEMO_CONNECTIONS} size={380} />
          </div>
        </section>

        <section className="border-t border-[var(--color-line)] py-16">
          <div className="grid gap-10 sm:grid-cols-3">
            <div>
              <p className="font-display text-2xl font-bold text-[var(--color-amber)]">01</p>
              <h3 className="mt-3 font-display text-lg font-semibold text-[var(--color-paper)]">Upload the folder</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-paper)]/60">
                Drag in as many tracks as you want. MP3 or WAV, any genre.
              </p>
            </div>
            <div>
              <p className="font-display text-2xl font-bold text-[var(--color-amber)]">02</p>
              <h3 className="mt-3 font-display text-lg font-semibold text-[var(--color-paper)]">We analyze BPM and key</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-paper)]/60">
                Every track gets placed on the Camelot wheel automatically —
                no ear training required.
              </p>
            </div>
            <div>
              <p className="font-display text-2xl font-bold text-[var(--color-amber)]">03</p>
              <h3 className="mt-3 font-display text-lg font-semibold text-[var(--color-paper)]">Get ranked matches</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-paper)]/60">
                See which pairs mix cleanly, then generate the mashup in one tap.
              </p>
            </div>
          </div>
        </section>

        <section className="border-t border-[var(--color-line)] py-16">
          <div className="rounded-2xl border border-[var(--color-line)] bg-white/[0.02] p-8 sm:p-10">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-display text-xl font-semibold text-[var(--color-paper)]">MashMix Pro</h3>
                <p className="mt-1 text-sm text-[var(--color-paper)]/60">Unlimited uploads, unlimited mashups.</p>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="font-display text-3xl font-bold text-[var(--color-paper)]">$9</span>
                <span className="text-sm text-[var(--color-paper)]/50">/month</span>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--color-line)] px-6 py-8 text-center text-xs text-[var(--color-paper)]/40 sm:px-10">
        MashMix — built for people who make music, not just play it.
      </footer>
    </div>
  );
}
