import 'package:flutter_riverpod/flutter_riverpod.dart';

enum ExportStatus { idle, queued, exporting, exported, failed }

enum ExportFormat { mp4Hd, mp4FullHd, mp44k }

class ExportState {
  final ExportStatus status;
  final double progress;
  final String? exportId;
  final String? downloadUrl;
  final ExportFormat format;
  final bool merge;
  final String? errorMessage;

  const ExportState({
    required this.status,
    this.progress = 0.0,
    this.exportId,
    this.downloadUrl,
    this.format = ExportFormat.mp4FullHd,
    this.merge = true,
    this.errorMessage,
  });

  ExportState copyWith({
    ExportStatus? status,
    double? progress,
    String? exportId,
    String? downloadUrl,
    ExportFormat? format,
    bool? merge,
    String? errorMessage,
  }) {
    return ExportState(
      status: status ?? this.status,
      progress: progress ?? this.progress,
      exportId: exportId ?? this.exportId,
      downloadUrl: downloadUrl ?? this.downloadUrl,
      format: format ?? this.format,
      merge: merge ?? this.merge,
      errorMessage: errorMessage ?? this.errorMessage,
    );
  }
}

class ExportNotifier extends StateNotifier<ExportState> {
  ExportNotifier() : super(const ExportState(status: ExportStatus.idle));

  Future<void> startExport({
    required List<String> highlightIds,
    required ExportFormat format,
    required bool merge,
  }) async {
    state = state.copyWith(
      status: ExportStatus.queued,
      format: format,
      merge: merge,
    );

    await Future.delayed(const Duration(milliseconds: 500));
    state = state.copyWith(status: ExportStatus.exporting);

    for (var i = 0; i <= 100; i += 20) {
      await Future.delayed(const Duration(milliseconds: 500));
      state = state.copyWith(progress: i / 100);
    }

    state = state.copyWith(
      status: ExportStatus.exported,
      progress: 1.0,
      exportId: 'export_demo',
      downloadUrl: 'https://example.com/demo.mp4',
    );
  }

  void updateFormat(ExportFormat format) {
    state = state.copyWith(format: format);
  }

  void updateMerge(bool merge) {
    state = state.copyWith(merge: merge);
  }

  void reset() {
    state = const ExportState(status: ExportStatus.idle);
  }
}

final exportProvider = StateNotifierProvider<ExportNotifier, ExportState>(
  (ref) => ExportNotifier(),
);
