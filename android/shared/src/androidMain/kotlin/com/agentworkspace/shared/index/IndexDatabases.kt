package com.agentworkspace.shared.index

import android.content.Context
import androidx.room3.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.IO

/**
 * Opens the index of a workspace on Android: `databases/index-<workspace id>.sqlite` in the private
 * data folder of the app (`Context.getDatabasePath`), never in the synced folder (docs/phase-1.md 3.5).
 */
fun openWorkspaceIndex(
    context: Context,
    workspaceId: String,
    dispatcher: CoroutineDispatcher = Dispatchers.IO,
): WorkspaceIndex {
    val database =
        Room
            .databaseBuilder<WorkspaceIndexDatabase>(context, context.getDatabasePath("index-$workspaceId.sqlite").path)
            .setDriver(BundledSQLiteDriver())
            .setQueryCoroutineContext(dispatcher)
            .fallbackToDestructiveMigration(dropAllTables = true)
            .build()
    return WorkspaceIndex(database)
}
