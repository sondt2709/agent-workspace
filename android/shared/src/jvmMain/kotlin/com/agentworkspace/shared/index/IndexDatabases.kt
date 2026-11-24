package com.agentworkspace.shared.index

import androidx.room3.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.IO

/** Opens the index on the JVM with the bundled SQLite driver. A null path opens an in-memory index. */
fun openWorkspaceIndex(
    path: String?,
    dispatcher: CoroutineDispatcher = Dispatchers.IO,
): WorkspaceIndex {
    val builder =
        if (path == null) {
            Room.inMemoryDatabaseBuilder<WorkspaceIndexDatabase>()
        } else {
            Room.databaseBuilder<WorkspaceIndexDatabase>(path)
        }
    val database =
        builder
            .setDriver(BundledSQLiteDriver())
            .setQueryCoroutineContext(dispatcher)
            .fallbackToDestructiveMigration(dropAllTables = true)
            .build()
    return WorkspaceIndex(database)
}
