import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { TranscriptSegment } from './transcript-segment.entity';
import { RecordingCategory, RecordingStatus } from '../common/enums';

@Entity('recordings')
export class Recording {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'varchar', length: 36 })
  userId!: string;

  @ManyToOne(() => User, (user) => user.recordings, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'varchar', length: 64, default: RecordingCategory.ENGLISH })
  category!: string;

  @Column({
    type: 'varchar',
    length: 32,
    default: RecordingStatus.RECORDING,
  })
  status!: RecordingStatus;

  @Column({ type: 'varchar', length: 32, default: '00:00' })
  duration!: string;

  @Column({ name: 'duration_sec', type: 'integer', default: 0 })
  durationSec!: number;

  @Column({ type: 'text', default: '' })
  summary!: string;

  @Column({ name: 'ai_summary', type: 'text', default: '' })
  aiSummary!: string;

  @Column({ type: 'simple-json', nullable: true })
  participants!: Array<{ name: string; role: string; avatar: string }> | null;

  @Column({ type: 'simple-json', nullable: true })
  tags!: string[] | null;

  @Column({ name: 'is_translated', type: 'boolean', default: false })
  isTranslated!: boolean;

  @Column({ name: 'audio_path', type: 'varchar', length: 500, nullable: true })
  audioPath!: string | null;

  @Column({ name: 'audio_mime', type: 'varchar', length: 64, nullable: true })
  audioMime!: string | null;

  @OneToMany(() => TranscriptSegment, (segment) => segment.recording, {
    cascade: true,
  })
  transcript!: TranscriptSegment[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt!: Date | null;
}
