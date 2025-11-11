// DownloadGrid.swift
import SwiftUI

struct DownloadGrid: View {
    let downloads: [VideoItem]
    let currentUser: String
    let onStatus: (String) -> Void
    let onDownload: (String) -> Void
    let onDelete: (String) -> Void

    private let cols: [GridItem] = [GridItem(.adaptive(minimum: 260), spacing: 12)]

    var body: some View {
        LazyVGrid(columns: cols, spacing: 12) {
            ForEach(downloads, id: \.id) { item in
                DownloadCard(
                    item: item,
                    isYou: (item.owner_username ?? currentUser) == currentUser,
                    onStatus: onStatus,
                    onDownload: onDownload,
                    onDelete: onDelete
                )
            }
        }
    }
}
