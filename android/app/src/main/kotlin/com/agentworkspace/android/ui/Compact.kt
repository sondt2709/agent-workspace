package com.agentworkspace.android.ui

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ButtonColors
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

// The compact components of the phone (openspec polish-prototype-style, docs/design.md 8.20). They
// have the names of the Material 3 components, so a screen in this package gets the compact one
// when it does not import the Material 3 one. Buttons are 36 dp high and text fields about 50 dp. The
// Material 3 touch target of 48 dp stays: a button keeps its 48 dp interactive size, and Compose
// extends the touch bounds of a smaller control.

/** The visual height of a compact button. */
val CompactButtonHeight = 36.dp

/** The minimum height of a compact text field. */
val CompactFieldHeight = 48.dp

private val ButtonPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp)
private val TextButtonPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp)

/** The corner of buttons and text fields: 6 dp, as on the desktop (docs/design.md 5). */
val CompactShape = RoundedCornerShape(6.dp)

/** A filled button with the accent: the main action of a view. */
@Composable
fun Button(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    colors: ButtonColors = ButtonDefaults.buttonColors(),
    contentPadding: PaddingValues = ButtonPadding,
    content: @Composable RowScope.() -> Unit,
) = androidx.compose.material3.Button(
    onClick = onClick,
    modifier = modifier.heightIn(min = CompactButtonHeight),
    enabled = enabled,
    shape = CompactShape,
    colors = colors,
    contentPadding = contentPadding,
    content = content,
)

/** An outlined button: the other actions of a view. */
@Composable
fun OutlinedButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    colors: ButtonColors = ButtonDefaults.outlinedButtonColors(),
    contentPadding: PaddingValues = ButtonPadding,
    content: @Composable RowScope.() -> Unit,
) = androidx.compose.material3.OutlinedButton(
    onClick = onClick,
    modifier = modifier.heightIn(min = CompactButtonHeight),
    enabled = enabled,
    shape = CompactShape,
    colors = colors,
    contentPadding = contentPadding,
    content = content,
)

/** A text button: a small action in a row, for example "Show more". */
@Composable
fun TextButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    colors: ButtonColors = ButtonDefaults.textButtonColors(),
    content: @Composable RowScope.() -> Unit,
) = androidx.compose.material3.TextButton(
    onClick = onClick,
    modifier = modifier.heightIn(min = CompactButtonHeight),
    enabled = enabled,
    shape = CompactShape,
    colors = colors,
    contentPadding = TextButtonPadding,
    content = content,
)

/**
 * An outlined text field with the 13 sp body text of the compact type scale and a minimum height of
 * 48 dp in place of the 56 dp of Material 3: about 50 dp high with one line. It is the value-based
 * Material 3 field, so the typing of the screens stays as it was (a state-based field with a value
 * bridge dropped fast input on an emulator).
 */
@Composable
fun OutlinedTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    readOnly: Boolean = false,
    label: (@Composable () -> Unit)? = null,
    placeholder: (@Composable () -> Unit)? = null,
    trailingIcon: (@Composable () -> Unit)? = null,
    supportingText: (@Composable () -> Unit)? = null,
    isError: Boolean = false,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    singleLine: Boolean = false,
    minLines: Int = 1,
    maxLines: Int = if (singleLine) 1 else Int.MAX_VALUE,
) = androidx.compose.material3.OutlinedTextField(
    value = value,
    onValueChange = onValueChange,
    // A minimum height that is not 0 turns off the 56 dp default minimum of Material 3.
    modifier = modifier.heightIn(min = CompactFieldHeight),
    enabled = enabled,
    readOnly = readOnly,
    textStyle = MaterialTheme.typography.bodyMedium,
    label = label,
    placeholder = placeholder,
    trailingIcon = trailingIcon,
    supportingText = supportingText,
    isError = isError,
    keyboardOptions = keyboardOptions,
    singleLine = singleLine,
    minLines = minLines,
    maxLines = maxLines,
    shape = CompactShape,
)
