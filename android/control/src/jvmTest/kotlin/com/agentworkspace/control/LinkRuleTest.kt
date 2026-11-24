package com.agentworkspace.control

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** The links that the phone Markdown opens (openspec polish-prototype-style). */
class LinkRuleTest {
    @Test
    fun opensOnlyHttpsLinks() {
        assertTrue(LinkRule.opens("https://example.com/docs"))
        assertFalse(LinkRule.opens("http://example.com"))
        assertFalse(LinkRule.opens("javascript:alert(1)"))
        assertFalse(LinkRule.opens("file:///data/data/com.agentworkspace.android/x"))
        assertFalse(LinkRule.opens("intent://example.com#Intent;end"))
        assertFalse(LinkRule.opens("HTTPS://example.com"))
    }
}
