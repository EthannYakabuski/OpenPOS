package org.openpos.mobile;

import static org.junit.Assert.*;
import org.junit.Test;

public class HelpDocumentTest {
    @Test public void embedsTheStylesheetForFormattedAndMinifiedHandbooks() {
        String css = "body{color:#163f35} .price:after{content:'$1'}";
        for (String link : new String[]{"<link rel=stylesheet href=style.css>", "<link rel=\"stylesheet\" href=\"style.css\" />", "<link href='style.css' rel='stylesheet'>", "<LINK\n REL=stylesheet\n HREF = style.css >"}) {
            assertEquals("<head><style>" + css + "</style></head>", HelpDocument.inlineStyle("<head>" + link + "</head>", css));
        }
        String other = "<link href=style.cssx><link href=other.css>";
        assertEquals(other, HelpDocument.inlineStyle(other, css));
    }
}
