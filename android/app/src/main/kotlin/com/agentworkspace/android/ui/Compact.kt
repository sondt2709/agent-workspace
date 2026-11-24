package com.agentworkspace.android.ui

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ButtonColors
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp

// The compact components of the phone (openspec polish-prototype-style and task-review-layout,
// docs/design.md 8.20). They have the names of the Material 3 components, so a screen in this package
// gets the compact one when it does not import the Material 3 one. One control height of 48 dp for
// buttons, option buttons, decision rows, one-line text fields and select fields; chips stay 32 dp.

/** The height of each control of a form or a card: buttons, option rows and one-line text fields. */
val ControlHeight = 48.dp

private val ButtonPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp)
private val TextButtonPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp)

/** The padding of a field: 12 dp above and below the 24 dp minimum line of Material 3 give 48 dp. */
private val FieldPadding = PaddingValues(horizontal = 12.dp, vertical = 12.dp)

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
    modifier = modifier.heightIn(min = ControlHeight),
    enabled = enabled,
    shape = CompactShape,
    colors = colors,
    contentPadding = contentPadding,
    content = content,
)

/** An outlined button: the other actions of a view, and a select field (a button that opens a menu). */
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
    modifier = modifier.heightIn(min = ControlHeight),
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
    modifier = modifier.heightIn(min = ControlHeight),
    enabled = enabled,
    shape = CompactShape,
    colors = colors,
    contentPadding = TextButtonPadding,
    content = content,
)

/**
 * An outlined text field of 48 dp with one line. The [label] shows above the field and the
 * [placeholder] inside it: a floating label needs 56 dp (openspec task-review-layout, design decision
 * 8). It is value-based, so the typing of the screens stays as it was (a state-based field with a
 * value bridge dropped fast input on an emulator).
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
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        if (label != null) {
            val color = if (isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant
            CompositionLocalProvider(LocalContentColor provides color) {
                ProvideTextStyle(MaterialTheme.typography.labelMedium) { label() }
            }
        }
        ControlField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.fillMaxWidth(),
            enabled = enabled,
            readOnly = readOnly,
            placeholder = placeholder,
            trailingIcon = trailingIcon,
            supportingText = supportingText,
            isError = isError,
            keyboardOptions = keyboardOptions,
            singleLine = singleLine,
            minLines = minLines,
            maxLines = maxLines,
        )
    }
}

/**
 * The field of [OutlinedTextField] with no label: 48 dp high with one line. Compose 1.13 deprecates
 * the value-based BasicTextField, and the value-based Material 3 field uses it too. A state-based
 * field with a value bridge dropped fast input on an emulator (polish-prototype-style), so the field
 * stays value-based until the screens keep a TextFieldState.
 */
@Suppress("DEPRECATION")
@Composable
fun ControlField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    readOnly: Boolean = false,
    placeholder: (@Composable () -> Unit)? = null,
    trailingIcon: (@Composable () -> Unit)? = null,
    supportingText: (@Composable () -> Unit)? = null,
    isError: Boolean = false,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    singleLine: Boolean = false,
    minLines: Int = 1,
    maxLines: Int = if (singleLine) 1 else Int.MAX_VALUE,
) {
    val interaction = remember { MutableInteractionSource() }
    val colors = OutlinedTextFieldDefaults.colors()
    val scheme = MaterialTheme.colorScheme
    val style =
        MaterialTheme.typography.bodyMedium.copy(
            color = if (enabled) scheme.onSurface else scheme.onSurface.copy(alpha = DISABLED_ALPHA),
        )
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.heightIn(min = ControlHeight),
        enabled = enabled,
        readOnly = readOnly,
        textStyle = style,
        keyboardOptions = keyboardOptions,
        singleLine = singleLine,
        minLines = minLines,
        maxLines = maxLines,
        interactionSource = interaction,
        cursorBrush = SolidColor(if (isError) scheme.error else scheme.primary),
    ) { inner ->
        OutlinedTextFieldDefaults.DecorationBox(
            value = value,
            innerTextField = inner,
            enabled = enabled,
            singleLine = singleLine,
            visualTransformation = VisualTransformation.None,
            interactionSource = interaction,
            isError = isError,
            // The placeholder has the body text of the field, so the field stays 48 dp.
            placeholder = placeholder?.let { p -> { ProvideTextStyle(MaterialTheme.typography.bodyMedium) { p() } } },
            trailingIcon = trailingIcon,
            supportingText = supportingText,
            colors = colors,
            contentPadding = FieldPadding,
            container = {
                OutlinedTextFieldDefaults.Container(
                    enabled = enabled,
                    isError = isError,
                    interactionSource = interaction,
                    colors = colors,
                    shape = CompactShape,
                )
            },
        )
    }
}

/** The alpha of the text of a disabled field (Material 3). */
private const val DISABLED_ALPHA = 0.38f
