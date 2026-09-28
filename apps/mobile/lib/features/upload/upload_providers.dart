import 'package:flutter_riverpod/flutter_riverpod.dart';

enum UploadStatus { idle, requestingSession, uploading, completed, failed }

class UploadState {
  final UploadStatus status;
  final double progress;
  final String? errorMessage;

  const UploadState({
    required this.status,
    this.progress = 0.0,
    this.errorMessage,
  });

  UploadState copyWith({
    UploadStatus? status,
    double? progress,
    String? errorMessage,
  }) {
    return UploadState(
      status: status ?? this.status,
      progress: progress ?? this.progress,
      errorMessage: errorMessage ?? this.errorMessage,
    );
  }
}

class UploadNotifier extends StateNotifier<UploadState> {
  UploadNotifier() : super(const UploadState(status: UploadStatus.idle));

  Future<void> startUpload(String filePath, String projectId) async {
    state = state.copyWith(status: UploadStatus.requestingSession);
    state = state.copyWith(status: UploadStatus.uploading);
    for (var i = 0; i <= 100; i += 10) {
      await Future.delayed(const Duration(milliseconds: 200));
      state = state.copyWith(progress: i / 100);
    }
    state = state.copyWith(status: UploadStatus.completed, progress: 1.0);
  }

  void reset() {
    state = const UploadState(status: UploadStatus.idle);
  }
}

final uploadProvider = StateNotifierProvider<UploadNotifier, UploadState>(
  (ref) => UploadNotifier(),
);
