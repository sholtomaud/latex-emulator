# Reference lookup fixtures

CSL-JSON as returned by DOI content negotiation
(`Accept: application/vnd.citationstyles.csl+json` on `https://doi.org/<doi>`).

These files were **constructed from the CSL-JSON schema and Crossref's
documented output, not recorded**: the development sandbox could not reach
doi.org. Replace them with recorded responses when a session can:

```bash
curl -sL -H 'Accept: application/vnd.citationstyles.csl+json' \
  https://doi.org/10.1016/j.ecolmodel.2003.12.032 > brown-2004.csl.json
```
