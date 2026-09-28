import 'package:flutter_riverpod/flutter_riverpod.dart';

enum ProcessingStage {
  idle,
  preparing,
  detecting,
  verifying,
  generatingClips,
  ready,
  failed,
}

class ProcessingState {
  final ProcessingStage stage;
  final double progress;
  final String? jobId;
  final String? errorMessage;

  const ProcessingState({
    required this.stage,
    this.progress = 0.0,
    this.jobId,
    this.errorMessage,
  });

  ProcessingState copyWith({
    ProcessingStage? stage,
    double? progress,
    String? jobId,
    String? errorMessage,
  }) {
    return ProcessingState(
      stage: stage ?? this.stage,
      progress: progress ?? this.progress,
      jobId: jobId ?? this.jobId,
      errorMessage: errorMessage ?? this.errorMessage,
    );
  }
}

class ProcessingNotifier extends StateNotifier<ProcessingState> {
  ProcessingNotifier()
      : super(const ProcessingState(stage: ProcessingStage.idle));

  Future<void> startProcessing(String videoId) async {
    const stages = [
      ProcessingStage.preparing,
      ProcessingStage.detecting,
      ProcessingStage.verifying,
      ProcessingStage.generatingClips,
      ProcessingStage.ready,
    ];
    const progressPerStage = [0.15, 0.5, 0.75, 0.95, 1.0];

    for (var i = 0; i < stages.length; i++) {
      await Future.delayed(const Duration(milliseconds: 800));
      state = state.copyWith(
        stage: stages[i],
        progress: progressPerStage[i],
        jobId: 'job_demo',
      );
    }
  }

  void reset() {
    state = const ProcessingState(stage: ProcessingStage.idle);
  }
}

final processingProvider =
    StateNotifierProvider<ProcessingNotifier, ProcessingState>(
  (ref) => ProcessingNotifier(),
);
