import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Recording } from './recording.entity';

@Entity('transcript_segments')
export class TranscriptSegment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'recording_id', type: 'varchar', length: 36 })
  recordingId!: string;

  @ManyToOne(() => Recording, (recording) => recording.transcript, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'recording_id' })
  recording!: Recording;

  @Column({ type: 'varchar', length: 16, default: '00:00' })
  time!: string;

  @Column({ name: 't_start_ms', type: 'integer', default: 0 })
  tStartMs!: number;

  @Column({ name: 't_end_ms', type: 'integer', default: 0 })
  tEndMs!: number;

  @Column({ type: 'varchar', length: 120, default: 'Speaker' })
  speaker!: string;

  @Column({ type: 'text' })
  text!: string;

  @Column({ type: 'text', nullable: true })
  translation!: string | null;

  @Column({ name: 'is_final', type: 'boolean', default: true })
  isFinal!: boolean;

  @Column({ name: 'seq', type: 'integer', default: 0 })
  seq!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
