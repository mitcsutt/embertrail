import { Button, Popover, Select, Stack, Text } from '@mitcsutt/kiln-ui'
import { useMemo } from 'react'

import { commonCurrencies, commonLocales } from '#features/locale/constants/currencies'
import { useRates } from '#features/locale/data/rates'
import { useLocale } from '#features/locale/hooks/useLocale'
import { setPreferences, usePreferences } from '#features/locale/stores/preferences'

const auto = 'auto'

const languageName = (tag: string, locale: string) =>
  new Intl.DisplayNames(locale, { type: 'language' }).of(tag) ?? tag
const currencyName = (code: string, locale: string) =>
  new Intl.DisplayNames(locale, { type: 'currency' }).of(code) ?? code

/** The header control for the viewer's locale and currency. Both follow the browser until set. */
export function LocaleSettings() {
  const stored = usePreferences()
  const { locale, currency } = useLocale()
  const { data } = useRates()

  const localeOptions = useMemo(() => {
    const tags = new Set<string>(commonLocales)
    if (stored.locale !== null) tags.add(stored.locale)
    return [
      { value: auto, label: `Browser default (${navigator.language})` },
      ...[...tags].map((tag) => ({ value: tag, label: `${languageName(tag, locale)} (${tag})` })),
    ]
  }, [stored.locale, locale])

  const currencyOptions = useMemo(() => {
    const codes = new Set<string>(['USD', ...Object.keys(data?.rates ?? {}).toSorted()])
    if (data?.rates === null || data === undefined)
      for (const code of commonCurrencies) codes.add(code)
    if (stored.currency !== null) codes.add(stored.currency)
    return [
      { value: auto, label: `Match the language (${currency})` },
      ...[...codes].map((code) => ({
        value: code,
        label: `${code}: ${currencyName(code, locale)}`,
      })),
    ]
  }, [data, stored.currency, currency, locale])

  return (
    <Popover>
      <Popover.Trigger asChild>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Language and currency: ${locale}, ${currency}`}
        >
          {currency}
        </Button>
      </Popover.Trigger>
      <Popover.Content aria-label="Language and currency">
        <Stack gap={3}>
          <Text size="sm" tone="muted">
            How numbers, dates and costs are written. Claude Code reports cost in USD; another
            currency is converted at the latest daily rate the Hub holds, so it is an estimate.
            Saved in this browser.
          </Text>
          <Select
            aria-label="Language and region"
            options={localeOptions}
            value={stored.locale ?? auto}
            onValueChange={(value) => {
              setPreferences({ ...stored, locale: value === auto ? null : value })
            }}
          />
          <Select
            aria-label="Currency"
            options={currencyOptions}
            value={stored.currency ?? auto}
            onValueChange={(value) => {
              setPreferences({ ...stored, currency: value === auto ? null : value })
            }}
          />
        </Stack>
      </Popover.Content>
    </Popover>
  )
}
