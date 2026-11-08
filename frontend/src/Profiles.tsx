// "Who's learning?": pick a profile before anything else, when the server has more than one.
import { choose, profiles, type Profile } from './profile'

/** A profile's tile color: one of the chart series colors, fixed by its place in config.toml. */
function color(p: Profile) {
  return `var(--color-chart-${(profiles().indexOf(p) % 6) + 1})`
}

export function Avatar({ profile, className = '' }: { profile: Profile; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ background: color(profile) }}
      className={`grid shrink-0 place-items-center font-semibold text-accent-fg select-none ${className}`}
    >
      {profile.name.trim().charAt(0).toUpperCase()}
    </span>
  )
}

export default function Profiles({ onChosen }: { onChosen: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-10 px-4 py-16">
      <h1 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">Who's learning?</h1>
      <ul className="flex flex-wrap justify-center gap-6 sm:gap-8">
        {profiles().map((p) => (
          <li key={p.id}>
            <button
              onClick={() => {
                choose(p.id)
                onChosen()
              }}
              className="group flex w-28 flex-col items-center gap-3 rounded-3xl text-muted transition hover:text-fg focus-visible:text-fg sm:w-36"
            >
              <Avatar
                profile={p}
                className="size-28 rounded-3xl text-5xl ring-fg/80 transition duration-150 group-hover:ring-4 group-focus-visible:ring-4 group-active:scale-[0.97] sm:size-36 sm:text-6xl"
              />
              <span className="w-full truncate text-center text-base">{p.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}
