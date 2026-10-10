package org.openpos.mobile;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Webpack may minify HTML attributes; the exported handbook must still be self-contained. */
public final class HelpDocument {
    private static final Pattern STYLESHEET = Pattern.compile("<link\\b[^>]*\\bhref\\s*=\\s*(?:\"style\\.css\"|'style\\.css'|style\\.css(?=\\s|/?>))[^>]*>", Pattern.CASE_INSENSITIVE);
    private HelpDocument() {}
    public static String inlineStyle(String html, String css) {
        return STYLESHEET.matcher(html).replaceAll(Matcher.quoteReplacement("<style>" + css + "</style>"));
    }
}
