package com.agentworkspace.android.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.agentworkspace.android.R

// The palette of the prototype (docs/design.md 2, openspec polish-prototype-style): the same values
// as `@aw/ui/tokens` of the desktop. The accent is the prototype yellow, the same value as "Needs
// you". No dynamic color: a wallpaper color would be a second accent.

/** The colors of the dark scheme (`tokens.dark`). */
internal object DarkTokens {
    val canvas = Color(0xFF08090A)
    val surface = Color(0xFF0F1011)
    val raised = Color(0xFF141517)
    val overlay = Color(0xFF1B1C1F)
    val overlayHover = Color(0xFF232428)
    val text = Color(0xFFF7F8F8)
    val text2 = Color(0xFFC9CDD3)
    val text3 = Color(0xFF8A8F98)
    val lineStrong = Color(0x24FFFFFF)
    val line = Color(0x14FFFFFF)
    val accent = Color(0xFFF0B429)
    val onAccent = Color(0xFF1A1200)
    val err = Color(0xFFEB5757)
    val onErr = Color(0xFF1A0505)
    val run = Color(0xFF4EA7FC)
    val ok = Color(0xFF4CB782)
}

/** The colors of the light scheme (`tokens.light`). */
internal object LightTokens {
    val canvas = Color(0xFFF7F7F8)
    val surface = Color(0xFFFFFFFF)
    val raised = Color(0xFFF4F4F5)
    val overlay = Color(0xFFFFFFFF)
    val overlayHover = Color(0xFFF1F1F3)
    val text = Color(0xFF171717)
    val text2 = Color(0xFF3F3F46)
    val text3 = Color(0xFF5E5E66)
    val lineStrong = Color(0x26000000)
    val line = Color(0x14000000)
    val accent = Color(0xFF8F5200)
    val onAccent = Color(0xFFFFFFFF)
    val err = Color(0xFFC93434)
    val onErr = Color(0xFFFFFFFF)
    val run = Color(0xFF1D6FD6)
    val ok = Color(0xFF14804F)
}

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

/**
 * The compact type scale of the phone (openspec polish-prototype-style): 1 to 2 sp smaller than the
 * Material 3 baseline, with 14 sp body text.
 */
internal val CompactTypography: Typography =
    Typography().run {
        fun TextStyle.size(
            size: Int,
            line: Int,
        ) = copy(fontSize = size.sp, lineHeight = line.sp)
        copy(
            displayLarge = displayLarge.size(48, 56),
            displayMedium = displayMedium.size(40, 48),
            displaySmall = displaySmall.size(32, 40),
            headlineLarge = headlineLarge.size(26, 32),
            headlineMedium = headlineMedium.size(22, 28),
            headlineSmall = headlineSmall.size(20, 26),
            titleLarge = titleLarge.size(18, 24),
            titleMedium = titleMedium.size(15, 20),
            titleSmall = titleSmall.size(13, 18),
            bodyLarge = bodyLarge.size(14, 20),
            bodyMedium = bodyMedium.size(13, 18),
            bodySmall = bodySmall.size(12, 16),
            labelLarge = labelLarge.size(13, 18),
            labelMedium = labelMedium.size(12, 16),
            labelSmall = labelSmall.size(11, 14),
        )
    }

/**
 * The info color (`run` of `@aw/ui/tokens`, the MUI `info` of the desktop): the edge of an agent
 * message in Activity and the done segments of the stage bar (openspec task-review-layout).
 */
@Composable
fun infoColor(): Color = if (isSystemInDarkTheme()) DarkTokens.run else LightTokens.run

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
