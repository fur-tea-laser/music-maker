import { h, Fragment } from "preact";

export const ClientIndex = ({
  bundleUrl,
  cssUrl,
}: {
  bundleUrl: string;
  cssUrl: string;
}) => (
  <html lang="en">
    <head>
      <meta charSet="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>SPA</title>
      <link rel="stylesheet" href={cssUrl} />
    </head>
    <body>
      <div id="app"></div>
      <script type="module" src={bundleUrl}></script>
    </body>
  </html>
);

