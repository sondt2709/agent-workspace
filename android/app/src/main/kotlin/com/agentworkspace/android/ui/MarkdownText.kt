package com.agentworkspace.android.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import com.agentworkspace.control.LinkRule
import com.mikepenz.markdown.m3.Markdown
import com.mikepenz.markdown.m3.markdownTypography
import com.mikepenz.markdown.model.State
import com.mikepenz.markdown.model.markdownAnimations
import com.mikepenz.markdown.model.parseMarkdown

/**
 * Claude output as Markdown (openspec polish-prototype-style), with the maintained renderer of
 * docs/tech-stack.md 2.5. The renderer draws Compose text: no HTML or script runs, and it loads no
 * image (no image transformer). A tap on a link opens the system browser only for `https://`.
 *
 * The text is parsed before the first draw, not in the background (the renderer default): else a row
 * of a lazy list shows with no height and then grows, and the list moves when the person scrolls up
 * (docs/design.md 8.19). [ParsedTexts] keeps the parsed texts, so a row that comes back into view does
 * not parse again.
 */
@Composable
fun MarkdownText(
    text: String,
    modifier: Modifier = Modifier,
    /** The body size of a proposal (openspec proposal-and-discussion), or null for the theme size. */
    textSize: Dp? = null,
) {
    val context = LocalContext.current
    val links = remember(context) { BrowserLinks(context) }
    val type = scaled(MaterialTheme.typography, textSize)
    val body = type.bodyMedium
    val state = remember(text) { ParsedTexts.of(text) }
    CompositionLocalProvider(LocalUriHandler provides links) {
        Markdown(
            state = state,
            modifier = modifier.fillMaxWidth(),
            // No size animation: the text has its full height at once.
            animations = markdownAnimations(animateTextSize = { this }),
            // Headings stay small inside a card or a message, as on the desktop (docs/design.md 3).
            typography =
                markdownTypography(
                    h1 = type.titleMedium,
                    h2 = type.titleMedium,
                    h3 = type.titleSmall,
                    h4 = type.titleSmall,
                    h5 = type.titleSmall,
                    h6 = type.titleSmall,
                    text = body,
                    code = type.bodySmall.copy(fontFamily = MonoFont),
                    quote = body,
                    paragraph = body,
                    ordered = body,
                    bullet = body,
                    list = body,
                    textLink =
                        TextLinkStyles(
                            style =
                                body
                                    .copy(
                                        color = MaterialTheme.colorScheme.primary,
                                        textDecoration = TextDecoration.Underline,
                                    ).toSpanStyle(),
                        ),
                ),
        )
    }
}

/**
 * The type scale with the body of [size] (a size in dp, so it does not grow twice with the font scale
 * of the system): the line height is 1.5 times the size, a heading is 2 dp larger, code 1 dp smaller.
 */
@Composable
private fun scaled(
    type: Typography,
    size: Dp?,
): Typography {
    if (size == null) return type
    val density = LocalDensity.current

    fun TextStyle.at(dp: Float) =
        with(density) { copy(fontSize = dp.dp.toSp(), lineHeight = (dp * LINE_HEIGHT).dp.toSp()) }
    val body = size.value
    return type.copy(
        bodyMedium = type.bodyMedium.at(body),
        bodySmall = type.bodySmall.at(body - 1),
        titleMedium = type.titleMedium.at(body + 2),
        titleSmall = type.titleSmall.at(body + 2),
    )
}

/** The line height of a proposal text, as a factor of the size. */
private const val LINE_HEIGHT = 1.5f

/** The parsed Markdown of the newest texts, by text. Only the main thread reads and writes it. */
private object ParsedTexts {
    private const val SIZE = 200
    private val parsed =
        object : LinkedHashMap<String, State>(SIZE, LOAD_FACTOR, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, State>?): Boolean = size > SIZE
        }

    fun of(text: String): State = parsed.getOrPut(text) { parseMarkdown(text) }
}

private const val LOAD_FACTOR = 0.75f

/** Opens a link of [LinkRule] in the system browser; other links do nothing. */
private class BrowserLinks(
    private val context: Context,
) : UriHandler {
    override fun openUri(uri: String) {
        if (!LinkRule.opens(uri)) return
        val intent = Intent(Intent.ACTION_VIEW, uri.toUri()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            // No browser on the device: the tap does nothing.
        }
    }
}
