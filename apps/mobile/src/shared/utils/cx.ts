export const cx = (...values: Array<string | false | null | undefined>) => {
  return values.filter(Boolean).join(' ')
}

const toCamelCase = (value: string) => value.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase())

const resolveStyleToken = (styles: Record<string, string>, token: string) => {
  if (!token) return ''
  return styles[token] ?? styles[toCamelCase(token)] ?? token
}

export const createStyleCx = (styles: Record<string, string>) => {
  return (...values: Array<string | false | null | undefined>) => {
    const resolved: string[] = []
    values.forEach((value) => {
      if (!value) return
      value
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean)
        .forEach((token) => {
          resolved.push(resolveStyleToken(styles, token))
        })
    })
    return cx(...resolved)
  }
}
