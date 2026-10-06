# Finance catalogues (#141)

One pair of files per finance area, so the areas can be translated and
reviewed separately: `<area>.en.ts` exports the English source and
`<area>.fr-CA.ts` the Quebec French, typed against it. Both are mounted under
`finance.<area>` in `../en.ts` and `../fr-CA.ts`, so a key missing from French
is a type error and fails `i18n.test.ts`.
