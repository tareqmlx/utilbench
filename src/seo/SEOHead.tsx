import { Helmet } from "react-helmet-async";
import { APP_NAME } from "../config";
import { DEFAULT_DESCRIPTION, DEFAULT_OG_IMAGE, SITE_URL } from "./constants";

interface SEOHeadProps {
  title: string;
  description?: string;
  canonicalPath?: string;
  ogType?: string;
  ogImage?: string;
  noIndex?: boolean;
}

export function SEOHead({
  title,
  description = DEFAULT_DESCRIPTION,
  canonicalPath,
  ogType = "website",
  ogImage = DEFAULT_OG_IMAGE,
  noIndex = false,
}: SEOHeadProps) {
  const canonicalUrl = canonicalPath ? `${SITE_URL}${canonicalPath}` : undefined;

  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      {noIndex && <meta name="robots" content="noindex, nofollow" />}
      {canonicalUrl && <link rel="canonical" href={canonicalUrl} />}

      {/* Open Graph */}
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={ogType} />
      <meta property="og:image" content={ogImage} />
      <meta property="og:site_name" content={APP_NAME} />
      <meta property="og:locale" content="en_US" />
      {canonicalUrl && <meta property="og:url" content={canonicalUrl} />}

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />
    </Helmet>
  );
}
