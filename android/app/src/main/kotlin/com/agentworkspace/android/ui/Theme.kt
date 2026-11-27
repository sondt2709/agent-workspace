package com.agentworkspace.android.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.agentworkspace.android.R

// The palette of the prototype (docs/design.md 2): the colors of DarkTokens and LightTokens come from
// AwTokens.kt, which scripts/tokens.ts generates from `@aw/ui/tokens` of the desktop (openspec
// phone-desktop-parity). The accent is the prototype yellow, the same value as "Needs you". No dynamic
// color: a wallpaper color would be a second accent.

/** A tint of a color on a surface for containers (12 % to 14 %, as the chips of the desktop). */
private fun tint(
    color: Color,
    on: Color,
    alpha: Float = 0.14f,
): Color = color.copy(alpha = alpha).compositeOver(on)

internal val DarkScheme =
    with(DarkTokens) {
        darkColorScheme(
            primary = accent,
            onPrimary = onAccent,
            primaryContainer = tint(accent, surface),
            onPrimaryContainer = text,
            secondary = text2,
            onSecondary = canvas,
            secondaryContainer = raised,
            onSecondaryContainer = text,
            tertiary = accent,
            onTertiary = onAccent,
            tertiaryContainer = tint(accent, surface),
            onTertiaryContainer = text,
            background = surface,
            onBackground = text,
            surface = surface,
            onSurface = text,
            surfaceVariant = raised,
            onSurfaceVariant = text3,
            surfaceTint = Color.Transparent,
            inverseSurface = text,
            inverseOnSurface = canvas,
            inversePrimary = LightTokens.accent,
            error = err,
            onError = onErr,
            errorContainer = tint(err, surface),
            onErrorContainer = text,
            outline = lineStrong.compositeOver(surface),
            outlineVariant = line.compositeOver(surface),
            scrim = Color.Black,
            surfaceBright = overlayHover,
            surfaceDim = canvas,
            surfaceContainerLowest = canvas,
            surfaceContainerLow = surface,
            surfaceContainer = raised,
            surfaceContainerHigh = overlay,
            surfaceContainerHighest = overlayHover,
        )
    }

internal val LightScheme =
    with(LightTokens) {
        lightColorScheme(
            primary = accent,
            onPrimary = onAccent,
            primaryContainer = tint(accent, surface, 0.12f),
            onPrimaryContainer = text,
            secondary = text2,
            onSecondary = surface,
            secondaryContainer = raised,
            onSecondaryContainer = text,
            tertiary = accent,
            onTertiary = onAccent,
            tertiaryContainer = tint(accent, surface, 0.12f),
            onTertiaryContainer = text,
            background = surface,
            onBackground = text,
            surface = surface,
            onSurface = text,
            surfaceVariant = raised,
            onSurfaceVariant = text3,
            surfaceTint = Color.Transparent,
            inverseSurface = text,
            inverseOnSurface = surface,
            inversePrimary = DarkTokens.accent,
            error = err,
            onError = onErr,
            errorContainer = tint(err, surface, 0.1f),
            onErrorContainer = text,
            outline = lineStrong.compositeOver(surface),
            outlineVariant = line.compositeOver(surface),
            scrim = Color.Black,
            surfaceBright = overlay,
            surfaceDim = canvas,
            surfaceContainerLowest = surface,
            surfaceContainerLow = canvas,
            surfaceContainer = raised,
            surfaceContainerHigh = overlayHover,
            surfaceContainerHighest = overlayHover,
        )
    }

/** The weights of the desktop type roles (docs/design.md 3): 400, 510 and 590, and 700 for Markdown bold. */
private val InterWeights = listOf(400, 510, 590, 700)

/**
 * Inter (the variable font of the rsms/inter release 4.1, OFL 1.1, see THIRD_PARTY_NOTICES) for all text
 * except code, as on the desktop (openspec phone-desktop-parity). One entry per weight sets the `wght` axis.
 */
val InterFont =
    FontFamily(
        InterWeights.map { weight ->
            Font(
                R.font.inter,
                FontWeight(weight),
                variationSettings = FontVariation.Settings(FontVariation.weight(weight)),
            )
        },
    )

/** The Inter features of the desktop: `cv11` (single-story a) and `ss01` (open digits). */
private const val INTER_FEATURES = "cv11, ss01"

/** A text style of Inter with the desktop features. */
private fun inter(
    size: Int,
    line: Int,
    weight: Int,
) = TextStyle(
    fontFamily = InterFont,
    fontFeatureSettings = INTER_FEATURES,
    fontSize = size.sp,
    lineHeight = line.sp,
    fontWeight = FontWeight(weight),
)

/** The type roles of the desktop (docs/design.md 3), with 14 sp body text on the phone. */
object AwType {
    /** The task title in the task page. */
    val titleLg = inter(22, 30, 590).copy(letterSpacing = (-0.33).sp)

    /** A page title, for example "All tasks". */
    val title = inter(18, 26, 590).copy(letterSpacing = (-0.18).sp)

    /** A card title or a section title. */
    val titleSm = inter(14, 20, 590)

    /** A row title, a button label, a tab label. */
    val bodyStrong = inter(14, 20, 510)

    /** Default text and the thread. */
    val body = inter(14, 21, 400)

    /** Meta lines, helper text, chips. */
    val meta = inter(12, 16, 400)

    /** Section labels and property names (in `text3`). */
    val label = inter(12, 16, 510)
}

/**
 * The compact type scale of the phone (openspec polish-prototype-style): 1 to 2 sp smaller than the
 * Material 3 baseline, with 14 sp body text, in Inter with the weights of the desktop (titles 590,
 * labels 510).
 */
internal val CompactTypography: Typography =
    Typography().run {
        fun TextStyle.size(
            size: Int,
            line: Int,
            weight: Int = 400,
        ) = copy(
            fontFamily = InterFont,
            fontFeatureSettings = INTER_FEATURES,
            fontSize = size.sp,
            lineHeight = line.sp,
            fontWeight = FontWeight(weight),
        )
        copy(
            displayLarge = displayLarge.size(48, 56),
            displayMedium = displayMedium.size(40, 48),
            displaySmall = displaySmall.size(32, 40),
            headlineLarge = headlineLarge.size(26, 32, 590),
            headlineMedium = headlineMedium.size(22, 28, 590),
            headlineSmall = headlineSmall.size(20, 26, 590),
            titleLarge = titleLarge.size(18, 24, 590),
            titleMedium = titleMedium.size(15, 20, 590),
            titleSmall = titleSmall.size(13, 18, 590),
            bodyLarge = bodyLarge.size(14, 20),
            bodyMedium = bodyMedium.size(13, 18),
            bodySmall = bodySmall.size(12, 16),
            labelLarge = labelLarge.size(14, 20, 510),
            labelMedium = labelMedium.size(12, 16, 510),
            labelSmall = labelSmall.size(11, 14, 510),
        )
    }

/**
 * The info color (`run` of `@aw/ui/tokens`, the MUI `info` of the desktop): the edge of an agent
 * message in Activity and the done segments of the stage bar (openspec task-review-layout).
 */
@Composable
fun infoColor(): Color = if (isSystemInDarkTheme()) DarkTokens.run else LightTokens.run

/** The color of done, allowed and synced (`ok` of `@aw/ui/tokens`). */
@Composable
fun okColor(): Color = if (isSystemInDarkTheme()) DarkTokens.ok else LightTokens.ok

/** The tone of a [StateChip]: the status colors of the desktop chips (docs/design.md 2). */
enum class ChipTone { YOU, RUN, ERR, OK, WAIT, NEUTRAL }

/**
 * The time of the clock module for the relative times of the screens ("2 min ago"). The root provides
 * the `now` of the view model (AppGraph.time), so no screen reads the system clock.
 */
val LocalNowMs = staticCompositionLocalOf { 0L }

/** The fill of the selected row and the active item (`selected` of `@aw/ui/tokens`). */
@Composable
fun selectedColor(): Color = if (isSystemInDarkTheme()) DarkTokens.selected else LightTokens.selected

/** The color of waiting, paused and queued (`wait` of `@aw/ui/tokens`). */
@Composable
fun waitColor(): Color = if (isSystemInDarkTheme()) DarkTokens.wait else LightTokens.wait

/**
 * The monospace font of the phone: JetBrains Mono (a variable font, OFL 1.1, see THIRD_PARTY_NOTICES)
 * has each box drawing glyph (U+2500 to U+257F), so a tree or a table in code never shows a missing glyph.
 */
val MonoFont =
    FontFamily(
        Font(R.font.jetbrains_mono, FontWeight.Normal),
        Font(R.font.jetbrains_mono, FontWeight.Medium),
        Font(R.font.jetbrains_mono, FontWeight.SemiBold),
        Font(R.font.jetbrains_mono, FontWeight.Bold),
    )

/** Material 3 with the prototype palette, light and dark, and the compact type scale. */
@Composable
fun AwTheme(content: @Composable () -> Unit) {
    val scheme = if (isSystemInDarkTheme()) DarkScheme else LightScheme
    MaterialTheme(colorScheme = scheme, typography = CompactTypography, content = content)
}
