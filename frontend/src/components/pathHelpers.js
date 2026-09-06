export function siblingPath(path, newName) {
  const lastSlash = path.lastIndexOf('/')
  const parent = lastSlash <= 0 ? '' : path.slice(0, lastSlash)
  return `${parent}/${newName}`
}
