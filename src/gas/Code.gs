/** Phase 2: serve the existing local-only prototype. No authentication or APIs yet. */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('さんすうしゅくだい｜カレンダー・テンキー試作版')
    .addMetaTag('viewport', 'width=device-width,initial-scale=1');
}
