// Who is learning on this device. Every API request carries the profile; switching reloads the app,
// so nothing cached for the previous profile survives.

export type Profile = { id: string; name: string }

const KEY = 'minerva.profile'

let current = localStorage.getItem(KEY) ?? ''
let all: Profile[] = []

export const profileId = () => current
export const profile = () => all.find((p) => p.id === current)
export const profiles = () => all

/** Loads the server's profiles. Returns whether one is chosen; a single profile is chosen automatically. */
export async function loadProfiles(): Promise<boolean> {
  const res = await fetch('/api/profiles')
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  all = await res.json()
  if (all.length === 1) choose(all[0].id)
  return all.some((p) => p.id === current)
}

export function choose(id: string) {
  current = id
  localStorage.setItem(KEY, id)
}

export function switchProfile() {
  localStorage.removeItem(KEY)
  location.assign('/')
}
